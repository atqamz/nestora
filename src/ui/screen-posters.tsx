import type { ItemRow } from "../../shared/tables.ts";
import type { ScreenKind } from "../domain/screen.ts";
import { needsPoster } from "../domain/tmdb.ts";
import { useDetails } from "../hooks/use-details.ts";
import type { Details } from "../hooks/use-details.ts";
import { useStamp } from "../hooks/use-plan.ts";
import { fillScreen } from "../store/details.ts";
import { text } from "./text.ts";

const WORDS = text.screen.posters;

const BOOKS = text.books.import;

export const postersLine = ({ phase, done, total, tally }: Pick<Details, "phase" | "done" | "total" | "tally">, remaining: number, kind: ScreenKind) =>
  phase === "running"
    ? BOOKS.progress(done, total, tally.unsure)
    : phase === "stopping"
      ? BOOKS.stopping
      : phase === "stopped"
        ? `${BOOKS.stopped} ${BOOKS.progress(done, total, tally.unsure)}`
        : phase === "offline"
          ? BOOKS.offline
          : phase === "busy"
            ? WORDS.busy(kind === "movie" ? text.movies.noun : text.series.noun)
            : phase === "finished"
              ? WORDS.finished(tally.filled, tally.empty + tally.failed, tally.unsure)
              : remaining > 0
                ? WORDS.need(remaining)
                : "";

export function ScreenPosters({ kind, rows }: { kind: ScreenKind; rows: readonly ItemRow[] }) {
  const stamp = useStamp();
  const { state, remaining, tried, start, stop } = useDetails(`screens-${kind}`, rows, {
    needs: (row) => needsPoster(row, stamp()),
    attempt: (lookup, _, current) => fillScreen(lookup, current, stamp()),
  });
  const going = state.phase === "running" || state.phase === "stopping";
  const again = tried > 0 || state.phase === "stopped" || state.phase === "offline" || state.phase === "busy";
  const line = postersLine(state, remaining, kind);
  if (line === "") return null;
  return (
    <div className="posters">
      <p className="hint imp-progress" role="status">
        {line}
      </p>
      <div className="imp-acts">
        {going ? (
          <button type="button" className="secondary" disabled={state.phase === "stopping"} onClick={stop}>
            {BOOKS.stop}
          </button>
        ) : (
          remaining > 0 && (
            <button type="button" className="secondary" onClick={() => void start()}>
              {again ? BOOKS.resume : WORDS.find}
            </button>
          )
        )}
      </div>
    </div>
  );
}
