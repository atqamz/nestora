import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Side } from "../../shared/api.ts";
import { count, isDone } from "../../shared/routines.ts";
import type { ItemRow } from "../../shared/tables.ts";
import { FRESH_MS, begin, clock, extend, parse, phase, share, timerKey } from "../domain/routine-timer.ts";
import type { Timer } from "../domain/routine-timer.ts";
import { useNow } from "../hooks/use-now.ts";
import { chime } from "./chime.ts";
import { Icon } from "./icons.tsx";
import { text } from "./text.ts";

const copy = text.routines;

const start = copy.start;

export type Moves = {
  routine: ItemRow;
  side: Side;
  day: string;
  say: (message: string) => void;
  tick: (action: ItemRow) => void;
  plus: (action: ItemRow) => void;
  done: (action: ItemRow, after?: () => void) => void;
  next: () => void;
};

type Props = Moves & { page: ItemRow[] };

const word = (row: ItemRow, key: string) => (typeof row.data?.[key] === "string" ? (row.data[key] as string) : null);

const read = (key: string) => {
  try {
    return parse(sessionStorage.getItem(key));
  } catch {
    return null;
  }
};

const write = (key: string, timer: Timer | null) => {
  try {
    if (timer === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(timer));
  } catch {}
};

function Timing({ action, minutes, finished, routine, say, done, next }: Moves & { action: ItemRow; minutes: number; finished: boolean }) {
  const key = timerKey(routine.id, action.id);
  const [timer, setTimer] = useState(() => read(key));
  const now = useNow(timer !== null);
  const current = phase(timer, now);
  const body = useRef<HTMLDivElement>(null);
  const seen = useRef<string | null>(null);

  const set = (next: Timer | null) => {
    write(key, next);
    setTimer(next);
  };

  useEffect(() => {
    const was = seen.current;
    seen.current = current.name;
    if (was === current.name) return;
    if (was !== null) body.current?.querySelector<HTMLElement>("[data-primary]")?.focus();
    if (current.name !== "ended") return;
    if (was === "running" && current.ago <= FRESH_MS) {
      chime.play();
      navigator.vibrate?.([200, 100, 200]);
    }
    if (was === "running" || was === null) say(start.timer.over(action.title));
  }, [current.name]);

  const go = () => {
    const at = Date.now();
    chime.unlock();
    set(begin(minutes, at));
    say(start.timer.began(start.timer.spoken(minutes * 60_000)));
  };

  if (finished) {
    return (
      <div className="start-do" ref={body}>
        <p className="start-state">
          <Icon name="check" />
          {start.done}
        </p>
        <button type="button" className="start-main" data-primary onClick={next}>
          {start.next}
        </button>
      </div>
    );
  }

  const left = current.name === "running" ? current.left : 0;
  const face = clock(left);
  return (
    <div className="start-timer" data-phase={current.name} ref={body}>
      {current.name === "idle" && (
        <>
          <p className="start-meta">{copy.minutes(minutes)}</p>
          <div className="start-do">
            <button type="button" className="start-main" data-primary onClick={go}>
              {start.timer.start(minutes)}
            </button>
            <button type="button" className="secondary start-alt" onClick={() => done(action)}>
              {start.done}
            </button>
          </div>
        </>
      )}
      {current.name === "running" && (
        <>
          <p className="start-clock" role="timer" aria-live="off" style={{ "--n": face.length } as CSSProperties}>
            {face}
          </p>
          <div className="start-bar" aria-hidden="true">
            <span style={{ width: `${Math.round(share(current) * 100)}%` }} />
          </div>
          {chime.locked() && <p className="hint">{start.locked}</p>}
          <div className="start-do">
            <button type="button" className="secondary start-alt" data-primary onClick={() => say(start.timer.remaining(start.timer.spoken(left)))}>
              {start.timer.ask}
            </button>
            <button type="button" className="secondary start-alt" onClick={() => set(extend(timer!, Date.now()))}>
              {start.timer.add}
            </button>
            <button type="button" className="secondary start-alt" onClick={() => set(null)}>
              {start.timer.cancel}
            </button>
            <button type="button" className="start-main" onClick={() => done(action, () => set(null))}>
              {start.done}
            </button>
          </div>
        </>
      )}
      {current.name === "ended" && (
        <>
          <p className="start-over">{start.timer.ended}</p>
          <div className="start-do">
            <button type="button" className="start-main" data-primary onClick={() => done(action, () => set(null))}>
              {start.done}
            </button>
            <button type="button" className="secondary start-alt" onClick={() => set(extend(timer!, Date.now()))}>
              {start.timer.add}
            </button>
            <button type="button" className="secondary start-alt" onClick={() => set(null)}>
              {start.timer.cancel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function StartPage(props: Props) {
  const { page, routine, side, day, tick, plus, done, next } = props;
  const [action] = page;
  const link = word(action, "url");

  if (action.kind === "pack") {
    return (
      <>
        <h2 className="start-title">{action.group_key?.trim() || start.items}</h2>
        <ul className="start-ticks">
          {page.map((item) => (
            <li key={item.id}>
              <label className="start-tick" data-done={isDone(item, side, day) || undefined}>
                <span className="start-box">
                  <input type="checkbox" checked={isDone(item, side, day)} onChange={() => tick(item)} />
                  <Icon name="check" />
                </span>
                <span className="start-tick-t">
                  {item.title}
                  <span className="visually-hidden">{isDone(item, side, day) ? text.reopen(item.title) : text.complete(item.title)}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="start-do">
          <button type="button" className="start-main" data-primary onClick={next}>
            {start.next}
          </button>
        </div>
      </>
    );
  }

  const title = action.kind === "day_type" ? start.today(action.title) : action.title;
  const finished = isDone(action, side, day);
  const head = <h2 className="start-title">{title}</h2>;

  if (action.kind === "text" || action.kind === "day_type") {
    return (
      <>
        {head}
        <div className="start-do">
          <button type="button" className="start-main" data-primary onClick={next}>
            {start.next}
          </button>
        </div>
      </>
    );
  }

  if (action.kind === "counter") {
    const unit = word(action, "unit");
    const reached = finished;
    return (
      <>
        {head}
        <p className="start-clock start-tally" aria-live="polite" style={{ "--n": 6 } as CSSProperties}>
          {copy.count(count(action, side, day), action.qty, unit)}
        </p>
        <div className="start-do">
          <button type="button" className={reached ? "secondary start-alt" : "start-main"} data-primary={!reached || undefined} aria-label={copy.plus(action.title)} onClick={() => plus(action)}>
            {copy.plusLabel}
          </button>
          <button type="button" className={reached ? "start-main" : "secondary start-alt"} data-primary={reached || undefined} onClick={next}>
            {start.next}
          </button>
        </div>
      </>
    );
  }

  const body = action.note ? <p className="start-note">{action.note}</p> : null;
  const open =
    link === null ? null : (
      <a className="button secondary start-alt" href={link} target="_blank" rel="noopener noreferrer" aria-label={copy.openNamed(action.title)}>
        {copy.open}
      </a>
    );

  if (action.kind === "timer" && typeof action.data?.minutes === "number") {
    return (
      <>
        {head}
        {body}
        <Timing {...props} action={action} minutes={action.data.minutes} finished={finished} />
      </>
    );
  }

  return (
    <>
      {head}
      {body}
      {finished && (
        <p className="start-state">
          <Icon name="check" />
          {start.done}
        </p>
      )}
      <div className="start-do">
        <button type="button" className="start-main" data-primary onClick={() => (finished ? next() : done(action))}>
          {finished ? start.next : start.done}
        </button>
        {open}
      </div>
    </>
  );
}
