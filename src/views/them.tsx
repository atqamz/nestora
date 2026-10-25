import { useMemo } from "react";
import { marks, themToday } from "../domain/timetable.ts";
import { useRoutineClock, useRoutines } from "../hooks/use-routines.ts";
import { SlotItem } from "../ui/timetable.tsx";
import { text } from "../ui/text.ts";

const copy = text.routines;

export function Them() {
  const { items, me } = useRoutines();
  const { day, elapsed } = useRoutineClock();
  const them = useMemo(() => themToday(items, me, day), [items, me, day]);
  if (them.routines.length === 0) return null;
  const single = them.routines.length === 1;
  return (
    <section className="group rt-them" aria-labelledby="rt-them">
      <h2 id="rt-them">{copy.them.title}</h2>
      {them.slots.length === 0 ? (
        <p className="empty">{copy.them.empty}</p>
      ) : (
        <ul className="rt-slots">
          {marks(them.slots, elapsed).map((mark) => (
            <SlotItem key={mark.slot.row.id} slot={mark.slot} mark={mark} />
          ))}
        </ul>
      )}
      <p className="trail">
        <a href={single ? `#/routines/${them.routines[0].id}` : "#/routines"}>{single ? copy.them.week : copy.all}</a>
      </p>
    </section>
  );
}
