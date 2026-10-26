import { useMemo, useState } from "react";
import { mine } from "../../shared/routines.ts";
import { allDone, routinesOf, sections, see, sum, tally, todayBlocks, unseen } from "../domain/routines.ts";
import { useRoutineFlows, useRoutines } from "../hooks/use-routines.ts";
import { formatDay } from "../ui/format.ts";
import { text } from "../ui/text.ts";
import { TodayBlock } from "./today-block.tsx";

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
  const [seen, setSeen] = useState(() => unseen(day));
  const next = see(seen, blocks, day);
  if (next !== seen) setSeen(next);
  const { open: current, done: rested, needed } = sections(blocks, seen.rested);
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
        <h2 id="rt-today">{copy.today(formatDay(day, day))}</h2>
        <p className="empty">{owned ? copy.nothingToday : copy.emptyHome}</p>
        {trail}
      </section>
    );
  }
  return (
    <section className="group rt-today" aria-labelledby="rt-today">
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <h2 id="rt-today">{copy.today(formatDay(day, day))}</h2>
          {total > 0 && <span className="rt-tally">{finished ? copy.allDone : copy.progress(done, total)}</span>}
        </summary>
        {current.map((block) => (
          <TodayBlock key={block.routine.id} block={block} items={items} flows={flows} me={me} day={day} />
        ))}
        {rested.length > 0 && (
          <>
            <p className="rt-label">{copy.doneToday}</p>
            {rested.map((block) => (
              <TodayBlock key={block.routine.id} block={block} items={items} flows={flows} me={me} day={day} />
            ))}
          </>
        )}
        {needed.length > 0 && (
          <details className="rt-needed">
            <summary>
              <span>{copy.whenNeeded}</span>
              <span className="rt-tally">{copy.progress(sum(needed).done, sum(needed).total)}</span>
            </summary>
            {needed.map((block) => (
              <TodayBlock key={block.routine.id} block={block} items={items} flows={flows} me={me} day={day} />
            ))}
          </details>
        )}
        {trail}
      </details>
    </section>
  );
}
