import { useEffect, useMemo, useRef, useState } from "react";
import type { Side } from "../../shared/api.ts";
import { actionOccursOn, dayLabel, keyFor } from "../../shared/routines.ts";
import type { ItemRow } from "../../shared/tables.ts";
import { clampTo, follow, isOpen, pagesOf, placeOf, position, screenOf, settled } from "../domain/routine-start.ts";
import type { Page } from "../domain/routine-start.ts";
import { actionsOf } from "../domain/routines.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { useRoutineFlows, useRoutines } from "../hooks/use-routines.ts";
import { useWakeLock } from "../hooks/use-wake-lock.ts";
import { timers } from "../store/browser.ts";
import { chime } from "../ui/chime.ts";
import { failureOf } from "../ui/failure.ts";
import { Icon } from "../ui/icons.tsx";
import type { Flows } from "../ui/routine-flows.ts";
import { press } from "../ui/press.ts";
import { StartPage } from "../ui/start-page.tsx";
import { text } from "../ui/text.ts";
import { Title } from "../ui/title.tsx";

const copy = text.routines;

const start = copy.start;

const MAX_DOTS = 12;

const heading = (page: Page) => (page[0].kind === "pack" ? page[0].group_key?.trim() || start.items : page[0].title);

const label = (page: Page) => (page[0].kind === "pack" ? page.map((row) => row.title).join(", ") : page[0].title);

function Session({ routine, items, flows, me, day }: { routine: ItemRow; items: readonly ItemRow[]; flows: Flows; me: Side; day: string }) {
  const actions = useMemo(() => actionsOf(items, routine).filter((action) => actionOccursOn(routine, action, day)), [items, routine, day]);
  const pages = useMemo(() => pagesOf(actions), [actions]);
  const side = keyFor(routine.who, me);
  const [place, setPlace] = useState(() => placeOf(pages, position(pages, side, day, timers.running(me, routine.id))));
  const [shown, setShown] = useState(day);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState<string[]>([]);
  const wake = useWakeLock();
  const { once } = useBusy();
  const root = useRef<HTMLElement>(null);
  const moved = useRef(false);
  const since = useRef(performance.now());
  const screen = screenOf(pages, place, side, day);
  const { at, open } = screen;
  const idle = screen.kind === "idle";
  const page = screen.kind === "page" ? screen.page : undefined;
  const current = page?.[0].id ?? null;
  const total = pages.length;
  const dayName = dayLabel(actions, day);

  if (shown !== day) {
    setShown(day);
    timers.keep(me, routine.id, null);
    setPlace(placeOf(pages, position(pages, side, day)));
    setMessage(start.newDay);
  } else {
    const followed = follow(pages, place);
    if (followed !== place) setPlace(followed);
  }

  const exit = () => {
    timers.keep(me, routine.id, null);
    location.replace(`#/routines/${routine.id}`);
  };

  const go = (to: number) => {
    const clamped = clampTo(to, total);
    moved.current = true;
    since.current = performance.now();
    setFailure([]);
    setPlace(placeOf(pages, clamped));
    setMessage(clamped >= total ? "" : start.announce(clamped + 1, total, heading(pages[clamped])));
  };

  useEffect(() => {
    const leave = (event: KeyboardEvent) => event.key === "Escape" && !event.defaultPrevented && exit();
    addEventListener("keydown", leave);
    return () => removeEventListener("keydown", leave);
  }, [routine.id]);

  useEffect(() => timers.keep(me, routine.id, current), [me, routine.id, current]);

  useEffect(() => {
    if (!moved.current) return;
    root.current?.querySelector<HTMLElement>("[data-primary]")?.focus();
  }, [current]);

  const write = (work: () => ReturnType<Flows["toggle"]>, then?: () => void) =>
    once(async () => {
      const result = await work();
      setFailure(failureOf(result));
      if (result.ok) then?.();
    });

  const moves = {
    routine,
    me,
    side,
    day,
    say: setMessage,
    tick: (action: ItemRow) => void write(() => flows.toggle(routine, action)),
    plus: (action: ItemRow) => void write(() => flows.plus(routine, action)),
    done: (action: ItemRow, after?: () => void) =>
      void write(
        () => flows.toggle(routine, action),
        () => {
          after?.();
          go(at + 1);
        },
      ),
    next: () => go(at + 1),
  };

  const touch = () => {
    chime.unlock();
    if (wake.state !== "held") wake.again();
  };

  const ending = open === 0 ? start.finished : start.left(open);
  const upcoming = pages[at + 1];

  return (
    <section
      ref={root}
      className="start"
      data-full
      aria-label={routine.title}
      onPointerUp={touch}
      onClickCapture={(event) => {
        if (settled(since.current, performance.now())) return;
        event.preventDefault();
        event.stopPropagation();
        press(event.target);
      }}
      onKeyDown={(event) => {
        if (event.repeat) event.preventDefault();
      }}
    >
      <div className="start-head">
        <Title className="start-name">{routine.title}</Title>
        {!idle && <span className="start-pos">{start.position(Math.min(at + 1, total), total)}</span>}
        <button type="button" className="ib" aria-label={start.exit} onClick={exit}>
          <Icon name="close" />
        </button>
      </div>
      {idle ? null : total > MAX_DOTS ? (
        <div className="start-bar" aria-hidden="true">
          <span style={{ width: `${Math.round((at / total) * 100)}%` }} />
        </div>
      ) : (
        <ol className="start-dots" aria-hidden="true">
          {pages.map((row, step) => (
            <li key={row[0].id} data-state={step === at ? "here" : step < at && !isOpen(row, side, day) ? "done" : "later"} />
          ))}
        </ol>
      )}
      {dayName !== null && <p className="start-meta">{copy.dayLabel(dayName)}</p>}
      <div className="start-page" key={`${day}:${current ?? "end"}`}>
        {page !== undefined ? (
          <>
            <StartPage {...moves} page={page} />
            <p className="start-up">{upcoming === undefined ? start.last : start.up(label(upcoming))}</p>
          </>
        ) : idle ? (
          <>
            <h2 className="start-title">{start.nothing}</h2>
            <div className="start-do">
              <button type="button" className="start-main" data-primary onClick={exit}>
                {start.leave}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="start-title">{ending}</h2>
            {open === 0 && <p className="start-note">{start.finishedBody}</p>}
            <div className="start-do">
              {open > 0 && (
                <button type="button" className="start-main" data-primary onClick={() => go(pages.findIndex((row) => isOpen(row, side, day)))}>
                  {start.toOpen}
                </button>
              )}
              <button type="button" className={open > 0 ? "secondary start-alt" : "start-main"} data-primary={open === 0 || undefined} onClick={exit}>
                {start.leave}
              </button>
            </div>
          </>
        )}
      </div>
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
      <div className="start-foot">
        <button type="button" className="secondary start-alt" disabled={at === 0 || idle} onClick={() => go(at - 1)}>
          {start.back}
        </button>
        {page !== undefined && isOpen(page, side, day) && (
          <button type="button" className="secondary start-alt" onClick={() => go(at + 1)}>
            {start.skip}
          </button>
        )}
      </div>
      {wake.state !== "idle" && <p className="hint start-awake">{wake.state === "held" ? start.awake : start.mayDim}</p>}
      <p className="visually-hidden" role="status">
        {page === undefined && !idle ? ending : message}
      </p>
    </section>
  );
}

export function RoutineStart({ id }: { id: string }) {
  const rows = useRoutines();
  const flows = useRoutineFlows(rows);
  const { items, me, day } = rows;
  const routine = items.find((row) => row.id === id && row.kind === "routine");
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
  return <Session key={routine.id} routine={routine} items={items} flows={flows} me={me} day={day} />;
}
