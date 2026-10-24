import { useMemo, useState } from "react";
import { actionOccursOn, mine } from "../../shared/routines.ts";
import { allDone, momentOf, routinesOf, tally, todayBlocks } from "../domain/routines.ts";
import { useRoutineFlows, useRoutines } from "../hooks/use-routines.ts";
import { formatDay } from "../ui/format.ts";
import { RoutineAction } from "../ui/routine-action.tsx";
import { momentLabel } from "../ui/routine-label.ts";
import { text } from "../ui/text.ts";

const copy = text.routines;

export function Today() {
  const { items, me, day } = useRoutines();
  const flows = useRoutineFlows();
  const blocks = useMemo(() => todayBlocks(items, me, day), [items, me, day]);
  const finished = allDone(blocks);
  const [open, setOpen] = useState(!finished);
  if (me === null) return null;
  const owned = routinesOf(items).some((routine) => mine(routine, me));
  const { done, total } = tally(blocks);
  const trail = (
    <p className="trail">
      <a href="#/routines">{owned ? copy.all : copy.create}</a>
    </p>
  );
  if (!owned || blocks.length === 0) {
    return (
      <section className="group rt-today" aria-labelledby="rt-today">
        <h3 id="rt-today">{copy.today(formatDay(day, day))}</h3>
        <p className="empty">{owned ? copy.nothingToday : copy.emptyHome}</p>
        {trail}
      </section>
    );
  }
  return (
    <section className="group rt-today" aria-labelledby="rt-today">
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <h3 id="rt-today">{copy.today(formatDay(day, day))}</h3>
          {total > 0 && <span className="rt-tally">{finished ? copy.allDone : copy.progress(done, total)}</span>}
        </summary>
        {blocks.map(({ routine, actions, label, progress }) => (
          <div key={routine.id} className="rt-block">
            <h4>
              <a href={`#/routines/${routine.id}`}>{label === null ? routine.title : `${routine.title} · ${label}`}</a>
              <span>{momentLabel(momentOf(routine))}</span>
              {progress.total > 0 && <span>{copy.progress(progress.done, progress.total)}</span>}
            </h4>
            <ul className="rows">
              {actions
                .filter((action) => action.kind !== "day_type")
                .map((action) => (
                  <RoutineAction key={action.id} routine={routine} action={action} flows={flows} me={me} today={day} active={actionOccursOn(routine, action, day)} />
                ))}
            </ul>
          </div>
        ))}
        {trail}
      </details>
    </section>
  );
}
