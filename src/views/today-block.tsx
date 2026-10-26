import { useEffect, useRef, useState } from "react";
import type { Side } from "../../shared/api.ts";
import { actionOccursOn } from "../../shared/routines.ts";
import type { ItemRow } from "../../shared/tables.ts";
import { pagesOf } from "../domain/routine-start.ts";
import { actionsOf, finished, momentOf, onDemand, weekStrip } from "../domain/routines.ts";
import type { Block } from "../domain/routines.ts";
import { Icon } from "../ui/icons.tsx";
import { RoutineAction } from "../ui/routine-action.tsx";
import type { Flows } from "../ui/routine-flows.ts";
import { momentLabel } from "../ui/routine-label.ts";
import { RoutineWeek } from "../ui/routine-week.tsx";
import { text } from "../ui/text.ts";

const copy = text.routines;

export const SETTLE_MS = 600;

type Fold = "open" | "settling" | "folded" | "kept";

type Props = { block: Block; items: readonly ItemRow[]; flows: Flows; me: Side; day: string };

export function TodayBlock({ block, items, flows, me, day }: Props) {
  const { routine, actions, label, progress, side } = block;
  const complete = finished(progress);
  const name = label === null ? routine.title : `${routine.title} · ${label}`;
  const [fold, setFold] = useState<Fold>(complete ? "folded" : "open");
  const [said, setSaid] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const link = useRef<HTMLAnchorElement>(null);
  const focus = useRef<"toggle" | "link" | null>(null);
  if (!complete && fold !== "open") {
    setFold("open");
    setSaid(false);
  } else if (complete && fold === "open") setFold("settling");
  useEffect(() => {
    if (fold !== "settling") return;
    const timer = setTimeout(() => {
      const inside = card.current?.contains(document.activeElement) === true;
      focus.current = inside ? "toggle" : null;
      setSaid(!inside);
      setFold("folded");
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [fold]);
  useEffect(() => {
    if (fold === "folded" && focus.current === "toggle") toggle.current?.focus();
    if (fold === "open" && focus.current === "link") link.current?.focus();
    if (fold === "folded" || fold === "open") focus.current = null;
  }, [fold]);
  const folding = fold === "folded" || fold === "kept";
  const strip = weekStrip(routine, actionsOf(items, routine), day, side);
  const again = () => {
    focus.current = "link";
    void flows.clear(routine, actions).then((result) => {
      if (!result.ok) focus.current = null;
    });
  };
  return (
    <div ref={card} className="rt-block" data-fold={fold}>
      <span className="visually-hidden" role="status">
        {said ? copy.finished(name) : ""}
      </span>
      <h3>
        {folding ? (
          <button type="button" ref={toggle} className="rt-fold" aria-expanded={fold === "kept"} aria-label={copy.finished(name)} onClick={() => setFold(fold === "kept" ? "folded" : "kept")}>
            <span className="rt-tick" aria-hidden="true">
              <Icon name="check" />
            </span>
            <span className="rt-name">{name}</span>
            <span className="rt-state">{copy.done}</span>
          </button>
        ) : (
          <>
            <a ref={link} href={`#/routines/${routine.id}`}>
              {name}
            </a>
            <span>{momentLabel(momentOf(routine))}</span>
            {progress.total > 0 && <span>{copy.progress(progress.done, progress.total)}</span>}
          </>
        )}
      </h3>
      <div hidden={fold === "folded"}>
        {strip !== null && <RoutineWeek strip={strip} compact />}
        <ul className="rows">
          {actions
            .filter((action) => action.kind !== "day_type")
            .map((action) => (
              <RoutineAction key={action.id} routine={routine} action={action} flows={flows} me={me} today={day} active={actionOccursOn(routine, action, day)} />
            ))}
        </ul>
        {!complete && pagesOf(actions).length > 0 && (
          <p className="rt-start">
            <a className="button secondary" href={`#/routines/${routine.id}/start`} aria-label={copy.start.openNamed(routine.title)}>
              <Icon name="play" />
              {copy.start.open}
            </a>
          </p>
        )}
        {folding && (
          <p className="rt-after">
            <a href={`#/routines/${routine.id}`} aria-label={copy.openRoutineNamed(routine.title)}>
              {copy.openRoutine}
            </a>
            {onDemand(block) && (
              <button type="button" className="secondary" aria-label={copy.againNamed(routine.title)} onClick={again}>
                {copy.again}
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
