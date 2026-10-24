import { useMemo, useState } from "react";
import type { Side } from "../../shared/api.ts";
import { actionOccursOn, keyFor, occursOn, paused, progress } from "../../shared/routines.ts";
import type { ItemRow } from "../../shared/tables.ts";
import { blankDraft, copyDraft } from "../domain/routine-draft.ts";
import { actionsOf, listing, routinesOf } from "../domain/routines.ts";
import { useRoutineFlows, useRoutines } from "../hooks/use-routines.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { failureOf } from "../ui/failure.ts";
import { Icon } from "../ui/icons.tsx";
import { PauseSheet, RoutineSheet } from "../ui/routine-sheet.tsx";
import type { Flows } from "../ui/routine-flows.ts";
import { momentLabel, scheduleLine, whenLine } from "../ui/routine-label.ts";
import { text } from "../ui/text.ts";
import { Title } from "../ui/title.tsx";
import { RoutineDetail } from "./routine.tsx";
import { RoutineStart } from "./routine-start.tsx";

const copy = text.routines;

type Sheet = { kind: "new" } | { kind: "copy"; routine: ItemRow } | { kind: "pause"; routine: ItemRow } | null;

function Row({ routine, items, me, day, flows, onCopy, onPause }: { routine: ItemRow; items: readonly ItemRow[]; me: Side; day: string; flows: Flows; onCopy: () => void; onPause: () => void }) {
  const { busy, once } = useBusy();
  const [failure, setFailure] = useState<string[]>([]);
  const away = paused(routine, day);
  const own = routine.who === me || routine.who === "both";
  const today = own && occursOn(routine, day);
  const { done, total } = progress(
    actionsOf(items, routine).filter((action) => actionOccursOn(routine, action, day)),
    keyFor(routine.who, me),
    day,
  );
  return (
    <li>
      <div className="row">
        <a className="row-b" href={`#/routines/${routine.id}`}>
          <span className="title">{routine.title}</span>
          <span className="meta">
            <span>{scheduleLine(routine, day)}</span>
            <span>{whenLine(routine, day)}</span>
            {today && total > 0 && <span>{copy.progress(done, total)}</span>}
            {routine.data?.private === true && <span>{copy.onlyYou}</span>}
          </span>
        </a>
        <span className="row-r rt-side">
          <span className="rt-btns">
            {away ? (
              <button type="button" className="secondary" disabled={busy} aria-label={copy.resumeNamed(routine.title)} onClick={() => once(async () => setFailure(failureOf(await flows.resume(routine))))}>
                {copy.resume}
              </button>
            ) : (
              <button type="button" className="secondary" aria-label={copy.pauseNamed(routine.title)} onClick={onPause}>
                {copy.pause}
              </button>
            )}
            <button type="button" className="secondary" aria-label={copy.duplicateNamed(routine.title)} onClick={onCopy}>
              {copy.duplicate}
            </button>
          </span>
        </span>
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
  const [sheet, setSheet] = useState<Sheet>(null);
  const routines = useMemo(() => routinesOf(items), [items]);
  const sections = useMemo(() => (me === null ? [] : listing(routines, me)), [routines, me]);
  if (me === null) return null;
  const duplicated = sheet?.kind === "copy" ? sheet.routine : undefined;
  return (
    <>
      <Title>{copy.title}</Title>
      <div className="rt-tools">
        <button type="button" onClick={() => setSheet({ kind: "new" })}>
          <Icon name="plus" />
          {copy.new}
        </button>
      </div>
      {routines.length === 0 && <p className="empty">{copy.empty}</p>}
      {sections.map(({ owner, moments }) => (
        <section key={owner} aria-labelledby={`rt-${owner}`}>
          <h2 id={`rt-${owner}`}>{copy.owner[owner]}</h2>
          {moments.map(({ key, routines: group }) => (
            <div key={key ?? ""} className="rt-group">
              <h3>{momentLabel(key)}</h3>
              <ul className="rows">
                {group.map((routine) => (
                  <Row key={routine.id} routine={routine} items={items} me={me} day={day} flows={flows} onCopy={() => setSheet({ kind: "copy", routine })} onPause={() => setSheet({ kind: "pause", routine })} />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      {sheet?.kind === "new" && <RoutineSheet start={blankDraft(me)} current={null} me={me} today={day} flows={flows} onClose={() => setSheet(null)} />}
      {duplicated && (
        <RoutineSheet start={copyDraft(duplicated, actionsOf(items, duplicated), () => crypto.randomUUID())} current={null} me={me} today={day} duplicate={duplicated} flows={flows} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === "pause" && <PauseSheet routine={sheet.routine} flows={flows} onClose={() => setSheet(null)} />}
    </>
  );
}

export function Routines({ id, sub }: { id?: string; sub?: string }) {
  if (id === undefined) return <RoutineList />;
  if (sub === undefined) return <RoutineDetail key={id} id={id} />;
  return sub === "start" ? <RoutineStart key={id} id={id} /> : <Title>{text.notFound}</Title>;
}
