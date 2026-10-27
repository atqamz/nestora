import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Side } from "../../shared/api.ts";
import { ACTION_KINDS, DAY_CODES, TIMETABLE } from "../../shared/routines.ts";
import type { DayCode } from "../../shared/routines.ts";
import type { ItemRow } from "../../shared/tables.ts";
import { addDays, daysBetween } from "../domain/dates.ts";
import { KIND_FIELDS, LIMITS, blankAction, forTimetable, savePlan } from "../domain/routine-draft.ts";
import type { ActionDraft, ActionKind, Current, Problem, RoutineDraft, Who } from "../domain/routine-draft.ts";
import { MOMENTS } from "../domain/routines.ts";
import { overlaps } from "../domain/timetable.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { useRoutineDay } from "../hooks/use-routines.ts";
import { useWriteLock } from "../hooks/use-write-lock.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { Avatar, Pair } from "./avatar.tsx";
import { failureOf } from "./failure.ts";
import { Field } from "./field.tsx";
import { Icon } from "./icons.tsx";
import { Modal } from "./modal.tsx";
import { lockedProps } from "./paused-note.tsx";
import type { Flows } from "./routine-flows.ts";
import { momentLabel } from "./routine-label.ts";
import { text } from "./text.ts";

const copy = text.routines;

const form = copy.form;

type Props = { start: RoutineDraft; current: Current | null; me: Side; today: string; duplicate?: ItemRow; gone?: boolean; flows: Flows; onAdded?: () => void; onClose: () => void };

const message = (problem: Problem) => (problem.code === "required" ? form.problem[problem.field as "title"] : problem.code === "order" ? form.problem.end : form.problem[problem.code]);

const KINDS_IN_TIMETABLE: readonly ActionKind[] = ["block"];

function DayChips({ label, days, onChange, hint, error }: { label: string; days: readonly DayCode[]; onChange: (days: DayCode[]) => void; hint?: string; error?: string }) {
  return (
    <fieldset className="field rt-days">
      <legend>{label}</legend>
      <div className="rt-dayset">
        {DAY_CODES.map((code, index) => (
          <button
            key={code}
            type="button"
            aria-pressed={days.includes(code)}
            aria-label={copy.dayNames[code]}
            aria-invalid={error && index === 0 ? true : undefined}
            onClick={() => onChange(days.includes(code) ? days.filter((day) => day !== code) : [...days, code])}
          >
            {copy.days[code]}
          </button>
        ))}
      </div>
      {hint && <p className="hint">{hint}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

type Edit = (patch: Partial<ActionDraft>) => void;

const FIELD_TYPE = { minutes: "int", qty: "int", unit: "text", start: "time", end: "time", where: "text", url: "url", note: "note" } as const;

const FIELD_MAX = { unit: LIMITS.unit, where: LIMITS.where, note: LIMITS.note } as const;

function ActionEditor({
  action,
  index,
  first,
  last,
  errors,
  timetable,
  clash,
  edit,
  move,
  remove,
}: {
  action: ActionDraft;
  index: number;
  first: boolean;
  last: boolean;
  errors: Record<string, string>;
  timetable: boolean;
  clash: string | null;
  edit: Edit;
  move: (step: -1 | 1) => void;
  remove: () => void;
}) {
  const name = `${form.kind[action.kind]} ${index + 1}`;
  const label = action.title.trim() || name;
  const inline = KIND_FIELDS[action.kind].filter((field) => field !== "note");
  const slot = timetable && action.kind === "block";
  return (
    <li className="rt-act" data-action={action.id}>
      <div className="rt-act-h">
        <Field control={{ name: `title-${action.id}`, label: name, type: "text", value: action.title, max: LIMITS.title, onChange: (title) => edit({ title }) }} error={errors.title} />
        <span className="acts">
          <button type="button" className="ib" data-part="up" disabled={first} aria-label={form.up(label)} onClick={() => move(-1)}>
            <Icon name="up" />
          </button>
          <button type="button" className="ib" data-part="down" disabled={last} aria-label={form.down(label)} onClick={() => move(1)}>
            <Icon name="down" />
          </button>
          <button type="button" className="ib" aria-label={form.remove(label)} onClick={remove}>
            <Icon name="trash" />
          </button>
        </span>
      </div>
      {inline.length > 0 && (
        <div className="rt-fields">
          {inline.map((field) => (
            <Field
              key={field}
              control={{
                name: `${field}-${action.id}`,
                label: form[field],
                type: FIELD_TYPE[field],
                value: action[field],
                max: field in FIELD_MAX ? FIELD_MAX[field as keyof typeof FIELD_MAX] : undefined,
                hint: slot && field === "end" ? form.endHint : undefined,
                onChange: (value) => edit({ [field]: value }),
              }}
              error={errors[field]}
            />
          ))}
        </div>
      )}
      {slot && <DayChips label={form.days} days={action.days} hint={form.blockDaysHint} onChange={(days) => edit({ days })} />}
      {clash !== null && <p className="hint rt-clash">{clash}</p>}
      {!slot && (
        <details className="rt-more">
          <summary>{form.options}</summary>
          {action.kind === "step" && (
            <Field control={{ name: `note-${action.id}`, label: form.note, type: "note", value: action.note, max: LIMITS.note, onChange: (note) => edit({ note }) }} />
          )}
          <Field control={{ name: `heading-${action.id}`, label: form.heading, type: "text", value: action.heading, max: LIMITS.heading, onChange: (heading) => edit({ heading }) }} />
          <DayChips label={form.actionDays} days={action.days} hint={form.actionDaysHint} onChange={(days) => edit({ days })} />
        </details>
      )}
    </li>
  );
}

export function RoutineSheet({ start, current, me, today, duplicate, gone = false, flows, onAdded, onClose }: Props) {
  const { label } = usePartner();
  const { busy, once } = useBusy();
  const { locked: held } = useWriteLock();
  const [opened] = useState(current);
  const [draft, setDraft] = useState(start);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [failure, setFailure] = useState<string[]>([]);
  const [focus, setFocus] = useState<string[] | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const revived = useRef(false);
  const notice = useId();
  const creating = opened === null;
  const locked = draft.private;
  const timetable = draft.moment === TIMETABLE;

  const set = (patch: Partial<RoutineDraft>) => setDraft((was) => ({ ...was, ...patch }));
  const editAction = (id: string): Edit => (patch) => setDraft((was) => ({ ...was, actions: was.actions.map((action) => (action.id === id ? { ...action, ...patch } : action)) }));

  useEffect(() => {
    if (focus === null) return;
    for (const selector of focus) {
      const target = body.current?.querySelector<HTMLElement>(selector);
      if (target && !(target as HTMLButtonElement).disabled) return void target.focus();
    }
  }, [focus]);

  useEffect(() => {
    body.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [problems]);

  useEffect(() => {
    if (gone || busy || !revived.current) return;
    revived.current = false;
    body.current?.querySelector<HTMLElement>("input")?.focus();
  }, [gone, busy]);

  const restore = () =>
    once(async () => {
      revived.current = true;
      const result = await flows.restore(current!.routine);
      if (!result.ok) revived.current = false;
      setFailure(failureOf(result));
    });

  const add = (kind: ActionKind) => {
    const added = blankAction(kind, crypto.randomUUID());
    set({ actions: [...draft.actions, added] });
    setFocus([`[data-action="${added.id}"] input`]);
  };

  const move = (id: string, step: -1 | 1) => {
    const at = draft.actions.findIndex((action) => action.id === id);
    const to = at + step;
    if (to < 0 || to >= draft.actions.length) return;
    const next = [...draft.actions];
    next.splice(to, 0, ...next.splice(at, 1));
    set({ actions: next });
    setFocus([`[data-action="${id}"] [data-part="${step < 0 ? "up" : "down"}"]`, `[data-action="${id}"] [data-part="${step < 0 ? "down" : "up"}"]`]);
  };

  const remove = (id: string) => {
    const at = draft.actions.findIndex((action) => action.id === id);
    const near = draft.actions[at + 1] ?? draft.actions[at - 1];
    set({ actions: draft.actions.filter((action) => action.id !== id) });
    setFocus([...(near ? [`[data-action="${near.id}"] input`] : []), ".rt-add button"]);
  };

  const errorsAt = (at: number | null) => Object.fromEntries(problems.filter((problem) => problem.at === at).map((problem) => [problem.field, message(problem)]));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (held) return;
    return once(async () => {
      const plan = savePlan(forTimetable(draft, me), opened, current, () => crypto.randomUUID());
      if (!plan.ok) {
        const lost = draft.actions.filter((action) => plan.gone.includes(action.id));
        setFailure(lost.map((action) => form.gone(action.title.trim() || form.untitled)));
        if (lost.length > 0) setDraft((was) => ({ ...was, actions: was.actions.filter((action) => !plan.gone.includes(action.id)) }));
        return setProblems(lost.length > 0 ? [] : plan.problems);
      }
      setProblems([]);
      const result = await flows.save(plan.steps, creating ? plan.id : null);
      if (result.ok) {
        onAdded?.();
        return onClose();
      }
      const named = !result.ok && result.step !== undefined ? plan.names[result.step] : undefined;
      setFailure(failureOf(result).map((error) => (named ? form.problemAt(named, error) : error)));
    });
  };

  const own = errorsAt(null);
  const moments = [...MOMENTS.map(String), ...(draft.moment !== "" && !(MOMENTS as readonly string[]).includes(draft.moment) ? [draft.moment] : [])];
  const clashes = overlaps(draft.actions, forTimetable(draft, me).days);
  const clashLine = (at: number) =>
    clashes[at].length === 0 ? null : form.overlaps(clashes[at].map((to) => draft.actions[to].title.trim() || `${form.kind.block} ${to + 1}`).join(", "));
  const everyChanged = (every: string) => set({ every, from: draft.from || (Number(every) > 1 ? today : "") });

  return (
    <Modal
      title={creating ? (duplicate ? copy.copyTitle : copy.newTitle) : copy.editTitle}
      onClose={onClose}
      onSubmit={submit}
      foot={
        <button type="submit" disabled={busy || gone} {...lockedProps(held)}>
          {creating ? form.create : form.save}
        </button>
      }
    >
      <div className="form rt-form" ref={body}>
        <p id={notice} className={gone ? "hint" : "visually-hidden"} role="status">
          {gone ? copy.goneOpen : ""}
        </p>
        {gone && (
          <button type="button" className="secondary" aria-describedby={notice} disabled={busy} onClick={restore}>
            {text.undo}
          </button>
        )}
        <Field control={{ name: "routine-title", label: form.name, type: "text", value: draft.title, max: LIMITS.title, onChange: (title) => set({ title }) }} error={own.title} />
        {creating && (
          <div className="field check-field">
            <label>
              <input type="checkbox" checked={draft.private} aria-describedby="rt-private-hint" onChange={(event) => set({ private: event.target.checked, who: event.target.checked ? me : draft.who })} /> {form.private}
            </label>
            <p className="hint" id="rt-private-hint">
              {form.privateHint}
            </p>
          </div>
        )}
        {!creating && locked && <p className="hint rt-private">{form.privateKept}</p>}
        {!locked && (
          <Field
            control={{
              name: "routine-who",
              label: form.whose,
              type: "text",
              required: true,
              choice: true,
              value: forTimetable(draft, me).who,
              options: [
                { value: "a", label: label("a"), icon: <Avatar side="a" /> },
                { value: "b", label: label("b"), icon: <Avatar side="b" /> },
                ...(timetable ? [] : [{ value: "both", label: text.both, icon: <Pair /> }]),
              ],
              onChange: (who) => set({ who: who as Who }),
            }}
          />
        )}
        <Field
          control={{
            name: "routine-moment",
            label: form.moment,
            type: "text",
            required: true,
            choice: true,
            value: draft.moment,
            options: moments.map((value) => ({ value, label: momentLabel(value) })),
            onChange: (moment) => set({ moment }),
          }}
        />
        {!timetable && <DayChips label={form.days} days={draft.days} onChange={(days) => set({ days })} error={own.days} />}
        <Field
          control={{
            name: "routine-every",
            label: form.every,
            type: "text",
            required: true,
            choice: true,
            value: draft.every,
            options: Object.entries(form.everyOptions).map(([value, name]) => ({ value, label: name })),
            onChange: everyChanged,
          }}
        />
        {Number(draft.every) > 1 && <Field control={{ name: "routine-from", label: form.from, type: "date", value: draft.from, onChange: (from) => set({ from }) }} error={own.from} />}
        {!timetable && <Field control={{ name: "routine-start", label: form.calendarStart, type: "time", value: draft.start, hint: form.calendarHint, onChange: (start) => set({ start }) }} error={own.start} />}
        {!timetable && draft.start.trim() !== "" && (
          <Field control={{ name: "routine-duration", label: form.duration, type: "int", value: draft.duration, max: String(LIMITS.minutes).length, hint: form.durationHint, onChange: (duration) => set({ duration }) }} error={own.duration} />
        )}
        {duplicate && !locked && <p className="hint">{form.makePrivate}</p>}

        <h3 className="rt-h">{form.actions}</h3>
        {draft.actions.length === 0 ? (
          <p className="empty">{form.noActions}</p>
        ) : (
          <ol className="rt-acts">
            {draft.actions.map((action, index) => (
              <ActionEditor
                key={action.id}
                action={action}
                index={index}
                first={index === 0}
                last={index === draft.actions.length - 1}
                errors={errorsAt(index)}
                timetable={timetable}
                clash={clashLine(index)}
                edit={editAction(action.id)}
                move={(step) => move(action.id, step)}
                remove={() => remove(action.id)}
              />
            ))}
          </ol>
        )}
        <div className="rt-add" role="group" aria-label={form.actions}>
          {ACTION_KINDS.filter((kind) => !timetable || KINDS_IN_TIMETABLE.includes(kind)).map((kind) => (
            <button key={kind} type="button" className="secondary" aria-label={form.addNamed[kind]} onClick={() => add(kind)}>
              <Icon name="plus" />
              {form.addKinds[kind]}
            </button>
          ))}
        </div>
        {failure.length > 0 && (
          <p className="error" role="alert">
            {failure.join(" ")}
          </p>
        )}
      </div>
    </Modal>
  );
}

const PRESETS = [1, 7, 14] as const;

export function PauseSheet({ routine, flows, onClose }: { routine: ItemRow; flows: Flows; onClose: () => void }) {
  const { busy, once } = useBusy();
  const { locked } = useWriteLock();
  const day = useRoutineDay();
  const [until, setUntil] = useState("");
  const [failure, setFailure] = useState<string[]>([]);
  const days = until === "" ? "" : String(daysBetween(day, until));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked) return;
    return once(async () => {
      const result = await flows.pause(routine, until);
      setFailure(failureOf(result));
      if (result.ok) onClose();
    });
  };
  return (
    <Modal
      title={copy.pauseTitle(routine.title)}
      onClose={onClose}
      onSubmit={submit}
      foot={
        <button type="submit" disabled={busy || until === ""} {...lockedProps(locked)}>
          {copy.pauseConfirm}
        </button>
      }
    >
      <div className="form rt-form">
        <Field
          control={{
            name: "pause-for",
            label: copy.pauseFor,
            type: "text",
            required: true,
            choice: true,
            first: true,
            value: days,
            options: PRESETS.map((n) => ({ value: String(n), label: copy.pausePreset[n] })),
            onChange: (value) => setUntil(addDays(day, Number(value))),
          }}
        />
        <Field control={{ name: "pause-until", label: copy.pauseUntil, type: "date", required: true, value: until, hint: copy.pauseHint, onChange: setUntil }} error={failure[0]} />
      </div>
    </Modal>
  );
}
