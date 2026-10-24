import { useMemo, useState } from "react";
import { actionOccursOn, dayLabel, keyFor, occursOn, paused, progress } from "../../shared/routines.ts";
import { copyDraft, draftOf } from "../domain/routine-draft.ts";
import { actionsOf, momentOf, runs } from "../domain/routines.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { useRoutineFlows, useRoutines } from "../hooks/use-routines.ts";
import { Who } from "../ui/avatar.tsx";
import { failureOf } from "../ui/failure.ts";
import { Icon } from "../ui/icons.tsx";
import { RoutineAction } from "../ui/routine-action.tsx";
import { momentLabel, scheduleLine, whenLine } from "../ui/routine-label.ts";
import { PauseSheet, RoutineSheet } from "../ui/routine-sheet.tsx";
import { text } from "../ui/text.ts";
import { Title } from "../ui/title.tsx";

const copy = text.routines;

type Sheet = "edit" | "copy" | "pause" | null;

export function RoutineDetail({ id }: { id: string }) {
  const { items, me, day } = useRoutines();
  const flows = useRoutineFlows();
  const { busy, once } = useBusy();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [failure, setFailure] = useState<string[]>([]);
  const routine = items.find((row) => row.id === id && row.kind === "routine");
  const actions = useMemo(() => (routine ? actionsOf(items, routine) : []), [items, routine]);
  if (!routine || me === null) {
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
  const away = paused(routine, day);
  const today = occursOn(routine, day);
  const todays = actions.filter((action) => actionOccursOn(routine, action, day));
  const { done, total } = progress(todays, keyFor(routine.who, me), day);
  const label = today ? dayLabel(todays, day) : null;
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
      <div className="rt-tools">
        <button type="button" onClick={() => setSheet("edit")}>
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
      {actions.length === 0 ? (
        <p className="empty">{copy.noActions}</p>
      ) : (
        runs(actions).map(({ heading, actions: group }, index) => (
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
      {sheet === "edit" && <RoutineSheet start={draftOf(routine, actions)} current={{ routine, actions }} me={me} today={day} flows={flows} onClose={() => setSheet(null)} />}
      {sheet === "copy" && (
        <RoutineSheet start={copyDraft(routine, actions, () => crypto.randomUUID())} current={null} me={me} today={day} duplicate={routine} flows={flows} onClose={() => setSheet(null)} />
      )}
      {sheet === "pause" && <PauseSheet routine={routine} flows={flows} onClose={() => setSheet(null)} />}
    </>
  );
}
