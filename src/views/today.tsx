import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { mine } from "../../shared/routines.ts";
import { allDone, finished as complete, openFirst, routinesOf, sections, see, sum, tally, todayBlocks, unseen } from "../domain/routines.ts";
import { useRoutineClock, useRoutineFlows, useRoutines } from "../hooks/use-routines.ts";
import { text } from "../ui/text.ts";
import { TodayBlock } from "./today-block.tsx";

const copy = text.routines;

let remembered: { day: string; id: string | null } | null = null;

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
  const [pick, setPick] = useState<string | null | undefined>(() => (remembered?.day === day && (remembered.id === null || blocks.some(({ routine }) => routine.id === remembered!.id)) ? remembered.id : undefined));
  const [shown, setShown] = useState(day);
  if (shown !== day) {
    setShown(day);
    setOpen(!finished);
    setPick(undefined);
  } else if (pick === undefined && blocks.length > 0) setPick(openFirst(blocks, elapsed));
  useEffect(() => {
    if (pick !== undefined) remembered = { day, id: pick };
  }, [day, pick]);
  const held = useRef<{ box: HTMLElement; top: number } | null>(null);
  useLayoutEffect(() => {
    const was = held.current;
    held.current = null;
    const drift = was === null ? 0 : was.box.getBoundingClientRect().top - was.top;
    if (drift !== 0) scrollBy({ top: drift, behavior: "instant" });
  }, [pick]);
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
        expanded={pick === id}
        onToggle={(box) => {
          if (box?.getBoundingClientRect) held.current = { box, top: box.getBoundingClientRect().top };
          setPick((now) => (now === id ? null : id));
        }}
        onFold={() => setPick((now) => (now === id ? null : now))}
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
