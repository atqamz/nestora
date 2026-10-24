import { useMemo, useState } from "react";
import { actionOccursOn, mine } from "../../shared/routines.ts";
import { pagesOf } from "../domain/routine-start.ts";
import { actionsOf, allDone, momentOf, routinesOf, tally, todayBlocks, weekStrip } from "../domain/routines.ts";
import { useRoutineFlows, useRoutines } from "../hooks/use-routines.ts";
import { formatDay } from "../ui/format.ts";
import { Icon } from "../ui/icons.tsx";
import { RoutineAction } from "../ui/routine-action.tsx";
import { RoutineWeek } from "../ui/routine-week.tsx";
import { momentLabel } from "../ui/routine-label.ts";
import { text } from "../ui/text.ts";

const copy = text.routines;

export function Today() {
  const rows = useRoutines();
  const flows = useRoutineFlows(rows);
  const { items, me, day } = rows;
  const blocks = useMemo(() => todayBlocks(items, me, day), [items, me, day]);
  const finished = allDone(blocks);
  const [open, setOpen] = useState(!finished);
  const [shown, setShown] = useState(day);
  if (shown !== day) {
    setShown(day);
    setOpen(!finished);
  }
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
        {blocks.map(({ routine, actions, label, progress, side }) => {
          const strip = weekStrip(routine, actionsOf(items, routine), day, side);
          return (
            <div key={routine.id} className="rt-block">
              <h4>
                <a href={`#/routines/${routine.id}`}>{label === null ? routine.title : `${routine.title} · ${label}`}</a>
                <span>{momentLabel(momentOf(routine))}</span>
                {progress.total > 0 && <span>{copy.progress(progress.done, progress.total)}</span>}
              </h4>
              {strip !== null && <RoutineWeek strip={strip} compact />}
              <ul className="rows">
                {actions
                  .filter((action) => action.kind !== "day_type")
                  .map((action) => (
                    <RoutineAction key={action.id} routine={routine} action={action} flows={flows} me={me} today={day} active={actionOccursOn(routine, action, day)} />
                  ))}
              </ul>
              {pagesOf(actions).length > 0 && (
                <p className="rt-start">
                  <a className="button secondary" href={`#/routines/${routine.id}/start`} aria-label={copy.start.openNamed(routine.title)}>
                    <Icon name="play" />
                    {copy.start.open}
                  </a>
                </p>
              )}
            </div>
          );
        })}
        {trail}
      </details>
    </section>
  );
}
