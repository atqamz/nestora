import { useEffect, useRef } from "react";
import type { Ref } from "react";
import type { ItemRow } from "../../shared/tables.ts";
import type { ScreenKind } from "../domain/screen.ts";
import { needsPoster } from "../domain/tmdb.ts";
import { useDetails } from "../hooks/use-details.ts";
import type { Details } from "../hooks/use-details.ts";
import { useTmdbDay } from "../hooks/use-plan.ts";
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

type Bar = { phase: Details["phase"]; line: string; remaining: number; again: boolean; start: () => void; stop: () => void };

export const resumes = (tried: number, phase: Details["phase"]) => tried > 0 || phase === "stopped" || phase === "offline" || phase === "busy";

export const takesFocus = (phase: Details["phase"], inside: boolean, active: unknown, body: unknown) =>
  phase === "finished" && (inside || active === null || active === body);

export function PostersBar({ phase, line, remaining, again, start, stop, status, bar }: Bar & { status?: Ref<HTMLParagraphElement>; bar?: Ref<HTMLDivElement> }) {
  const going = phase === "running" || phase === "stopping";
  const spent = phase === "finished" && remaining === 0;
  return (
    <div className="posters" ref={bar}>
      <p className="hint imp-progress" role="status" tabIndex={-1} ref={status}>
        {line}
      </p>
      <div className="imp-acts">
        {going || spent ? (
          <button type="button" className="secondary" disabled={phase === "stopping"} data-spent={spent || undefined} onClick={stop}>
            {BOOKS.stop}
          </button>
        ) : (
          remaining > 0 && (
            <button type="button" className="secondary" onClick={start}>
              {again ? BOOKS.resume : WORDS.find}
            </button>
          )
        )}
      </div>
    </div>
  );
}

export function ScreenPosters({ kind, rows }: { kind: ScreenKind; rows: readonly ItemRow[] }) {
  const stamp = useTmdbDay();
  const { state, remaining, tried, start, stop } = useDetails(`screens-${kind}`, rows, {
    needs: (row) => needsPoster(row, stamp()),
    attempt: (lookup, _, current) => fillScreen(lookup, current, stamp()),
  });
  const status = useRef<HTMLParagraphElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const again = resumes(tried, state.phase);
  const line = postersLine(state, remaining, kind);
  useEffect(() => {
    if (takesFocus(state.phase, bar.current?.contains(document.activeElement) ?? false, document.activeElement, document.body)) status.current?.focus();
  }, [state.phase]);
  if (line === "") return null;
  return <PostersBar phase={state.phase} line={line} remaining={remaining} again={again} start={() => void start()} stop={stop} status={status} bar={bar} />;
}
