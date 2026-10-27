import { blankDraft } from "../domain/routine-draft.ts";
import { useRoutineFlows, useRoutines } from "../hooks/use-routines.ts";
import { overlay, useOverlay } from "./overlay.ts";
import { RoutineSheet } from "./routine-sheet.tsx";
import { ScreenSheet } from "./screen-sheet.tsx";

const added = () => overlay.keepDraft(null);

function NewRoutine({ title }: { title: string }) {
  const rows = useRoutines();
  const flows = useRoutineFlows(rows);
  if (rows.me === null) return null;
  return <RoutineSheet start={{ ...blankDraft(rows.me), title }} current={null} me={rows.me} today={rows.day} flows={flows} onAdded={added} onClose={overlay.closeCompose} />;
}

export function Compose() {
  const { compose } = useOverlay();
  if (compose === null) return null;
  return compose.kind === "routine" ? <NewRoutine title={compose.title} /> : <ScreenSheet kind={compose.kind} title={compose.title} onAdded={added} onClose={overlay.closeCompose} />;
}
