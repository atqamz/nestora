import { useMemo, useState } from "react";
import type { Side } from "../../shared/api.ts";
import { actionOccursOn, dayLabel, isTimetable, keyFor, occursOn, paused, progress } from "../../shared/routines.ts";
import type { ItemRow } from "../../shared/tables.ts";
import { copyDraft, draftOf } from "../domain/routine-draft.ts";
import { pagesOf } from "../domain/routine-start.ts";
import { actionsOf, momentOf, runs, weekStrip } from "../domain/routines.ts";
import { weekOf } from "../domain/timetable.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { useOpenRow } from "../hooks/use-open-row.ts";
import { useRoutineFlows, useRoutines } from "../hooks/use-routines.ts";
import { Who } from "../ui/avatar.tsx";
import { failureOf } from "../ui/failure.ts";
import { Icon } from "../ui/icons.tsx";
import { RoutineAction } from "../ui/routine-action.tsx";
import type { Flows } from "../ui/routine-flows.ts";
import { RoutineWeek } from "../ui/routine-week.tsx";
import { momentLabel, scheduleLine, whenLine } from "../ui/routine-label.ts";
import { PauseSheet, RoutineSheet } from "../ui/routine-sheet.tsx";
import { text } from "../ui/text.ts";
import { Timetable } from "../ui/timetable.tsx";
import { Title } from "../ui/title.tsx";

const copy = text.routines;

type Sheet = "edit" | "copy" | "pause" | null;

type Open = { routine: ItemRow; actions: ItemRow[] };

function Missing() {
  return (
    <>
      <Title>{copy.missing}</Title>
      <p className="trail">
        <a href="#/routines">
          <Icon name="back" />
          {copy.back}
        </a>
      </p>
    </>
  );
}

type PageProps = Open & { me: Side; day: string; flows: Flows; setSheet: (sheet: Sheet) => void };

function RoutinePage({ routine, actions, me, day, flows, setSheet }: PageProps) {
  const { busy, once } = useBusy();
  const [failure, setFailure] = useState<string[]>([]);
  const away = paused(routine, day);
  const today = occursOn(routine, day);
  const todays = actions.filter((action) => actionOccursOn(routine, action, day));
  const { done, total } = progress(todays, keyFor(routine.who, me), day);
  const strip = weekStrip(routine, actions, day, keyFor(routine.who, me));
  const label = today ? dayLabel(todays, day) : null;
  const table = isTimetable(routine);
  const listed = table ? actions.filter((action) => action.kind !== "block") : actions;
  return (
    <>
      <p className="trail">
        <a href="#/routines">
          <Icon name="back" />
          {copy.back}
        </a>
      </p>
      <Title>{routine.title}</Title>
      <p className="meta rt-meta">
        <Who side={routine.who} />
        <span>{momentLabel(momentOf(routine))}</span>
        <span>{scheduleLine(routine, day)}</span>
        {routine.data?.private === true && <span>{copy.onlyYou}</span>}
      </p>
      <p className="hint rt-when">
        {whenLine(routine, day)}
        {label !== null && ` · ${copy.dayLabel(label)}`}
        {today && total > 0 && ` · ${copy.progress(done, total)}`}
      </p>
      {strip !== null && <RoutineWeek strip={strip} />}
      {table && <Timetable days={weekOf(routine, actions, day)} today={day} />}
      <div className="rt-tools">
        {today && !away && pagesOf(todays).length > 0 && (
          <a className="button" href={`#/routines/${routine.id}/start`}>
            <Icon name="play" />
            {copy.start.open}
          </a>
        )}
        <button type="button" className="secondary" onClick={() => setSheet("edit")}>
          <Icon name="edit" />
          {copy.edit}
        </button>
        <button type="button" className="secondary" onClick={() => setSheet("copy")}>
          {copy.duplicate}
        </button>
        {away ? (
          <button type="button" className="secondary" disabled={busy} onClick={() => once(async () => setFailure(failureOf(await flows.resume(routine))))}>
            {copy.resume}
          </button>
        ) : (
          <button type="button" className="secondary" onClick={() => setSheet("pause")}>
            {copy.pause}
          </button>
        )}
      </div>
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
      {listed.length === 0 ? (
        table ? null : <p className="empty">{copy.noActions}</p>
      ) : (
        runs(listed).map(({ heading, actions: group }, index) => (
          <section key={`${index}-${heading ?? ""}`} className="rt-run" aria-label={heading ?? undefined}>
            {heading !== null && <h2>{heading}</h2>}
            <ul className="rows">
              {group.map((action) => (
                <RoutineAction key={action.id} routine={routine} action={action} flows={flows} me={me} today={day} active={actionOccursOn(routine, action, day)} full />
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

export function RoutineDetail({ id }: { id: string }) {
  const rows = useRoutines();
  const flows = useRoutineFlows(rows);
  const { items, me, day } = rows;
  const [sheet, setSheet] = useState<Sheet>(null);
  const found = useMemo(() => {
    const routine = items.find((row) => row.id === id && row.kind === "routine");
    return routine && { routine, actions: actionsOf(items, routine) };
  }, [items, id]);
  const { row: open, gone } = useOpenRow(found);
  const kept = open !== undefined && me !== null;
  return (
    <>
      {kept && !gone ? <RoutinePage {...open} me={me} day={day} flows={flows} setSheet={setSheet} /> : <Missing />}
      {kept && sheet === "edit" && <RoutineSheet start={draftOf(open.routine, open.actions)} current={open} me={me} today={day} gone={gone} flows={flows} onClose={() => setSheet(null)} />}
      {kept && sheet === "copy" && (
        <RoutineSheet start={copyDraft(open.routine, open.actions, () => crypto.randomUUID())} current={null} me={me} today={day} duplicate={open.routine} flows={flows} onClose={() => setSheet(null)} />
      )}
      {kept && !gone && sheet === "pause" && <PauseSheet routine={open.routine} flows={flows} onClose={() => setSheet(null)} />}
    </>
  );
}
