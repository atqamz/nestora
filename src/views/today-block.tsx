import { useEffect, useRef, useState } from "react";
import type { Side } from "../../shared/api.ts";
import { actionOccursOn } from "../../shared/routines.ts";
import type { ItemRow } from "../../shared/tables.ts";
import { offerOf } from "../domain/routine-start.ts";
import { actionsOf, finished, momentOf, onDemand, weekStrip } from "../domain/routines.ts";
import type { Block } from "../domain/routines.ts";
import { useWriteLock } from "../hooks/use-write-lock.ts";
import { useHeld } from "../hooks/use-held.ts";
import { Icon } from "../ui/icons.tsx";
import { RoutineAction } from "../ui/routine-action.tsx";
import type { Flows } from "../ui/routine-flows.ts";
import { momentLabel } from "../ui/routine-label.ts";
import { RoutineWeek } from "../ui/routine-week.tsx";
import { text } from "../ui/text.ts";

const copy = text.routines;

export const SETTLE_MS = 600;
export const QUIET_MS = 500;
export const SETTLE_CAP_MS = 3000;

const TOUCHES = ["pointerdown", "touchstart", "keydown"] as const;

type Fold = "open" | "settling" | "folded";

type Props = { block: Block; items: readonly ItemRow[]; flows: Flows; me: Side; day: string; expanded: boolean; onToggle: (box: HTMLElement | null) => void; onFold: () => void };

export function TodayBlock({ block, items, flows, me, day, expanded, onToggle, onFold }: Props) {
  const { routine, actions, label, progress, side } = block;
  const complete = finished(progress);
  const name = label === null ? routine.title : `${routine.title} · ${label}`;
  const [fold, setFold] = useState<Fold>(complete ? "folded" : "open");
  const [said, setSaid] = useState(false);
  const { locked, guard } = useWriteLock();
  const card = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const focus = useRef<"toggle" | null>(null);
  if (!complete && fold !== "open") {
    setFold("open");
    setSaid(false);
  } else if (complete && fold === "open") setFold("settling");
  useEffect(() => {
    if (fold !== "settling") return;
    const start = Date.now();
    let touched = 0;
    let timer: ReturnType<typeof setTimeout>;
    const note = () => {
      touched = Date.now();
    };
    const arm = (wait: number) => {
      timer = setTimeout(() => {
        const left = Math.min(touched + QUIET_MS, start + SETTLE_CAP_MS) - Date.now();
        if (left > 0) return arm(left);
        const inside = card.current?.contains(document.activeElement) === true;
        focus.current = inside ? "toggle" : null;
        setSaid(!inside);
        setFold("folded");
        onFold();
      }, wait);
    };
    for (const event of TOUCHES) document.addEventListener(event, note, true);
    arm(SETTLE_MS);
    return () => {
      clearTimeout(timer);
      for (const event of TOUCHES) document.removeEventListener(event, note, true);
    };
  }, [fold]);
  useEffect(() => {
    if ((fold === "folded" || fold === "open") && focus.current === "toggle") toggle.current?.focus();
    if (fold === "folded" || fold === "open") focus.current = null;
  }, [fold]);
  const folding = fold === "folded";
  const offer = useHeld(offerOf(routine, actions, side, day), folding, day);
  const go = offer === "continue" ? copy.start.resume : copy.start.open;
  const strip = weekStrip(routine, actionsOf(items, routine), day, side);
  const sub = [momentLabel(momentOf(routine)), progress.total > 0 ? copy.progress(progress.done, progress.total) : null].filter((part) => part !== null).join(" · ");
  const again = () => {
    focus.current = "toggle";
    void flows.clear(routine, actions).then((result) => {
      if (!result.ok) focus.current = null;
    });
  };
  return (
    <div ref={card} className="rt-block" data-fold={folding && expanded ? "kept" : fold}>
      <span className="visually-hidden" role="status">
        {said ? copy.finished(name) : ""}
      </span>
      <div className="rt-head">
        <h3>
          <button
            type="button"
            ref={toggle}
            className={folding ? "rt-fold" : "rt-fold rt-live"}
            data-opens={folding ? `#/routines/${routine.id}/start` : undefined}
            data-replaces={folding ? undefined : `#/routines/${routine.id}/start`}
            aria-expanded={expanded}
            aria-label={folding ? copy.finished(name) : undefined}
            onClick={() => onToggle(toggle.current)}
          >
            {folding ? (
              <>
                <span className="rt-tick" aria-hidden="true">
                  <Icon name="check" />
                </span>
                <span className="rt-name">{name}</span>
                <span className="rt-state">{copy.done}</span>
              </>
            ) : (
              <span className="rt-name">
                {name}
                <span className="rt-sub">{sub}</span>
              </span>
            )}
          </button>
        </h3>
        {offer !== null && expanded && (
          <a className="button secondary rt-go" href={`#/routines/${routine.id}/start`} aria-label={copy.start.openNamed(go, routine.title)}>
            <Icon name="play" />
            <span className="rt-word" data-wide={copy.start.open}>
              <span>{go}</span>
            </span>
          </a>
        )}
      </div>
      <div hidden={!expanded}>
        {strip !== null && <RoutineWeek strip={strip} compact />}
        <ul className="rows">
          {actions
            .filter((action) => action.kind !== "day_type")
            .map((action) => (
              <RoutineAction key={action.id} routine={routine} action={action} flows={flows} me={me} today={day} active={actionOccursOn(routine, action, day)} />
            ))}
        </ul>
        {expanded && (
          <p className="rt-after">
            <a href={`#/routines/${routine.id}`} aria-label={copy.openRoutineNamed(routine.title)}>
              {copy.openRoutine}
            </a>
            {onDemand(block) && (
              <button type="button" className="secondary" aria-label={copy.againNamed(routine.title)} aria-disabled={locked || undefined} onClick={guard(again)}>
                {copy.again}
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
