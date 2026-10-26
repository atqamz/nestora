import { useMemo, useState } from "react";
import type { Side } from "../../shared/api.ts";
import { TIMETABLE, actionOccursOn, keyFor, paused, progress } from "../../shared/routines.ts";
import type { ItemRow } from "../../shared/tables.ts";
import { blankDraft } from "../domain/routine-draft.ts";
import { actionsOf, listing, routinesOf } from "../domain/routines.ts";
import { useRoutineFlows, useRoutines } from "../hooks/use-routines.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { failureOf } from "../ui/failure.ts";
import { Icon } from "../ui/icons.tsx";
import { RoutineSheet } from "../ui/routine-sheet.tsx";
import type { Flows } from "../ui/routine-flows.ts";
import { momentLabel, rowStatus } from "../ui/routine-label.ts";
import { text } from "../ui/text.ts";
import { Title } from "../ui/title.tsx";
import { RoutineDetail } from "./routine.tsx";
import { RoutineStart } from "./routine-start.tsx";

const copy = text.routines;

type Sheet = { kind: "new" | "timetable" } | null;

function Row({ routine, items, me, day, flows }: { routine: ItemRow; items: readonly ItemRow[]; me: Side; day: string; flows: Flows }) {
  const { busy, once } = useBusy();
  const [failure, setFailure] = useState<string[]>([]);
  const own = routine.who === me || routine.who === "both";
  const tally = own
    ? progress(
        actionsOf(items, routine).filter((action) => actionOccursOn(routine, action, day)),
        keyFor(routine.who, me),
        day,
      )
    : null;
  const away = paused(routine, day);
  return (
    <li>
      <div className="row rt-row">
        <a className="rt-link" href={`#/routines/${routine.id}`}>
          <span className="rt-text">
            <span className="title">{routine.title}</span>
            <span className="meta">
              <span>{rowStatus(routine, day, tally)}</span>
              {routine.data?.private === true && <span>{copy.onlyYou}</span>}
            </span>
          </span>
          {!away && <Icon name="forward" />}
        </a>
        {away && (
          <button type="button" className="pill rt-resume" disabled={busy} aria-label={copy.resumeNamed(routine.title)} onClick={() => once(async () => setFailure(failureOf(await flows.resume(routine))))}>
            {copy.resume}
          </button>
        )}
      </div>
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
    </li>
  );
}

function RoutineList() {
  const rows = useRoutines();
  const flows = useRoutineFlows(rows);
  const { items, me, day } = rows;
  const { nickname } = usePartner();
  const [sheet, setSheet] = useState<Sheet>(null);
  const routines = useMemo(() => routinesOf(items), [items]);
  const sections = useMemo(() => (me === null ? [] : listing(routines, me)), [routines, me]);
  if (me === null) return null;
  return (
    <>
      <Title>{copy.title}</Title>
      <div className="rt-tools">
        <button type="button" onClick={() => setSheet({ kind: "new" })}>
          <Icon name="plus" />
          {copy.new}
        </button>
        <button type="button" className="secondary" onClick={() => setSheet({ kind: "timetable" })}>
          <Icon name="plus" />
          {copy.newTimetable}
        </button>
      </div>
      {routines.length === 0 && <p className="empty">{copy.empty}</p>}
      {sections.map(({ owner, moments }) => (
        <section key={owner} aria-labelledby={`rt-${owner}`}>
          <h2 id={`rt-${owner}`}>{owner === "both" ? copy.owner.both : copy.owner[owner](nickname(owner === "mine" ? me : me === "a" ? "b" : "a"))}</h2>
          {moments.map(({ key, routines: group }) => (
            <div key={key ?? ""} className="rt-group">
              <h3>{momentLabel(key)}</h3>
              <ul className="rows">
                {group.map((routine) => (
                  <Row key={routine.id} routine={routine} items={items} me={me} day={day} flows={flows} />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      {sheet !== null && (
        <RoutineSheet start={blankDraft(me, sheet.kind === "timetable" ? TIMETABLE : undefined)} current={null} me={me} today={day} flows={flows} onClose={() => setSheet(null)} />
      )}
    </>
  );
}

export function Routines({ id, sub }: { id?: string; sub?: string }) {
  if (id === undefined) return <RoutineList />;
  if (sub === undefined) return <RoutineDetail key={id} id={id} />;
  return sub === "start" ? <RoutineStart key={id} id={id} /> : <Title>{text.notFound}</Title>;
}
