import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { mine } from "../../shared/routines.ts";
import { allDone, finished as complete, openFirst, routinesOf, sections, see, sum, tally, todayBlocks, unseen } from "../domain/routines.ts";
import { useRoutineClock, useRoutineFlows, useRoutines } from "../hooks/use-routines.ts";
import { text } from "../ui/text.ts";
import { TodayBlock } from "./today-block.tsx";

const copy = text.routines;

let remembered: { day: string; ids: string[] } | null = null;

export const forget = () => {
  remembered = null;
};

export function Today() {
  const rows = useRoutines();
  const flows = useRoutineFlows(rows);
  const { items, me, day } = rows;
  const blocks = useMemo(() => todayBlocks(items, me, day), [items, me, day]);
  const finished = allDone(blocks);
  const [open, setOpen] = useState(!finished);
  const [doneOpen, setDoneOpen] = useState(false);
  const { elapsed } = useRoutineClock();
  const [picks, setPicks] = useState<string[] | undefined>(() => {
    if (remembered?.day !== day) return undefined;
    const ids = remembered.ids.filter((id) => blocks.some(({ routine }) => routine.id === id));
    return ids.length > 0 || remembered.ids.length === 0 ? ids : undefined;
  });
  const [shown, setShown] = useState(day);
  if (shown !== day) {
    setShown(day);
    setOpen(!finished);
    setPicks(undefined);
  } else if (picks === undefined && blocks.length > 0) {
    const first = openFirst(blocks, elapsed);
    setPicks(first === null ? [] : [first]);
  }
  useEffect(() => {
    if (picks !== undefined) remembered = { day, ids: picks };
  }, [day, picks]);
  const held = useRef<{ box: HTMLElement; top: number; others: string[] } | null>(null);
  useLayoutEffect(() => {
    const was = held.current;
    held.current = null;
    if (was === null || picks === undefined) return;
    const drift = () => was.box.getBoundingClientRect().top - was.top;
    if (drift() !== 0) scrollBy({ top: drift(), behavior: "instant" });
    if (drift() !== 0 && was.others.some((id) => !picks.includes(id))) {
      held.current = was;
      setPicks([...new Set([...was.others, ...picks])]);
    }
  }, [picks]);
  const [seen, setSeen] = useState(() => unseen(day));
  const next = see(seen, blocks, day);
  if (next !== seen) setSeen(next);
  const { open: current, done: rested, needed } = sections(blocks, seen.rested);
  if (me === null) return null;
  const row = (block: (typeof blocks)[number]) => {
    const id = block.routine.id;
    return (
      <TodayBlock
        key={id}
        block={block}
        items={items}
        flows={flows}
        me={me}
        day={day}
        expanded={picks?.includes(id) === true}
        onToggle={(box) => {
          const before = picks ?? [];
          if (box?.getBoundingClientRect) held.current = { box, top: box.getBoundingClientRect().top, others: before.filter((other) => other !== id) };
          setPicks(before.includes(id) ? before.filter((other) => other !== id) : [id]);
        }}
        onFold={() => setPicks((now) => now?.filter((other) => other !== id))}
      />
    );
  };
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
        <h2 id="rt-today">{copy.title}</h2>
        <p className="empty">{owned ? copy.nothingToday : copy.emptyHome}</p>
        {trail}
      </section>
    );
  }
  return (
    <section className="group rt-today" aria-labelledby="rt-today">
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <h2 id="rt-today">{copy.title}</h2>
          {total > 0 && <span className="rt-tally">{finished ? copy.allDone : copy.progress(done, total)}</span>}
        </summary>
        {current.map(row)}
        {rested.length > 0 && (
          <details className="rt-done" open={doneOpen || rested.some(({ progress }) => !complete(progress))} onToggle={(event) => setDoneOpen(event.currentTarget.open)}>
            <summary>
              <span>{copy.doneGroup(rested.length)}</span>
            </summary>
            {rested.map(row)}
          </details>
        )}
        {needed.length > 0 && (
          <details className="rt-needed">
            <summary>
              <span>{copy.whenNeeded}</span>
              <span className="rt-tally">{copy.progress(sum(needed).done, sum(needed).total)}</span>
            </summary>
            {needed.map(row)}
          </details>
        )}
        {trail}
      </details>
    </section>
  );
}
