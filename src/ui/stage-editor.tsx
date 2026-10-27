import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { MONTH_MAX, MONTH_MIN, STAGE_NAME_MAX, stageProblems } from "../../shared/validate.ts";
import { STAGES, addStage, canAddStage, monthStart, moveStage, removeStage } from "../domain/stages.ts";
import type { Stage } from "../domain/stages.ts";
import { settingKeys } from "../domain/settings.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { actions } from "../hooks/use-store.ts";
import { useWriteLock } from "../hooks/use-write-lock.ts";
import { failureOf } from "./failure.ts";
import { formatMonth } from "./format.ts";
import { Icon } from "./icons.tsx";
import { overlay } from "./overlay.ts";
import { text } from "./text.ts";

type Props = { saved: readonly Stage[]; ceremony: string | null };

const OFFSETS = Array.from({ length: MONTH_MAX - MONTH_MIN + 1 }, (_, i) => MONTH_MIN + i);

const same = (a: readonly Stage[], b: readonly Stage[]) => JSON.stringify(a) === JSON.stringify(b);

export function StageEditor({ saved, ceremony }: Props) {
  const [list, setList] = useState<Stage[]>(() => saved.map((stage) => ({ ...stage })));
  const [failure, setFailure] = useState<string[]>([]);
  const { busy, once } = useBusy();
  const { locked, hold } = useWriteLock();
  const form = useRef<HTMLFormElement>(null);
  const trimmed = useMemo(() => list.map((stage) => ({ ...stage, name: stage.name.trim() })), [list]);
  const problems = useMemo(() => stageProblems(trimmed), [trimmed]);
  const changed = !same(trimmed, saved);

  const patch = (index: number, change: Partial<Stage>) => setList((current) => current.map((stage, at) => (at === index ? { ...stage, ...change } : stage)));

  const problemOf = (index: number, field: "name" | "from" | "to" | "key") => {
    const found = problems.find((problem) => problem.index === index && (problem.field === field || (field === "name" && problem.field === "key")));
    return found === undefined ? undefined : text.stages.problem[found.code];
  };

  const label = (offset: number) => text.stages.month(offset, ceremony === null ? null : formatMonth(monthStart(ceremony, offset)));

  const refocus = useRef<{ key: string; tool: "up" | "down" } | "add" | "last" | null>(null);

  useEffect(() => {
    const target = refocus.current;
    refocus.current = null;
    if (target === null) return;
    const find = (selector: string) => form.current?.querySelector<HTMLButtonElement>(selector);
    if (target === "last") return [...(form.current?.querySelectorAll<HTMLElement>(".stage input") ?? [])].at(-1)?.focus();
    const button =
      target === "add"
        ? find("[data-tool=add]:not(:disabled)") ?? find("[data-tool=reset]")
        : [target.tool, target.tool === "up" ? "down" : "up"].map((tool) => find(`[data-stage="${target.key}"] [data-tool=${tool}]:not(:disabled)`)).find(Boolean);
    button?.focus();
  }, [list]);

  const move = (index: number, step: -1 | 1) => {
    refocus.current = { key: list[index].key, tool: step === -1 ? "up" : "down" };
    setList((current) => moveStage(current, index, step));
  };

  const remove = (index: number) => {
    refocus.current = "add";
    setList((current) => removeStage(current, index));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked) return hold();
    if (problems.length > 0) {
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    return once(async () => {
      const result = await actions.setSetting(settingKeys.stages, JSON.stringify(trimmed));
      setFailure(failureOf(result));
      if (result.ok) overlay.announce(text.stages.saved);
    });
  };

  return (
    <details className="stages">
      <summary>
        <span>{text.stages.heading}</span>
        <small>{text.stages.count(saved.length)}</small>
      </summary>
      <form ref={form} noValidate onSubmit={submit} aria-label={text.stages.heading}>
        <p className="hint">{text.stages.intro}</p>
        <ol className="stage-list">
          {list.map((stage, index) => {
            const name = stage.name.trim() === "" ? "" : stage.name;
            const nameProblem = problemOf(index, "name");
            const fromProblem = problemOf(index, "from");
            const toProblem = problemOf(index, "to");
            return (
              <li key={stage.key}>
                <fieldset className="stage" data-stage={stage.key}>
                  <legend>{text.stages.stage(index + 1, name)}</legend>
                  <div className="field">
                    <label htmlFor={`stage-name-${stage.key}`}>{text.stages.name}</label>
                    <input
                      id={`stage-name-${stage.key}`}
                      aria-label={text.stages.nameOf(index + 1)}
                      value={stage.name}
                      maxLength={STAGE_NAME_MAX}
                      autoComplete="off"
                      autoCapitalize="sentences"
                      aria-invalid={nameProblem ? true : undefined}
                      aria-describedby={nameProblem ? `stage-name-${stage.key}-error` : undefined}
                      onChange={(event) => patch(index, { name: event.target.value })}
                    />
                    {nameProblem && (
                      <p className="error" id={`stage-name-${stage.key}-error`} role="alert">
                        {nameProblem}
                      </p>
                    )}
                  </div>
                  <div className="months">
                    {(["from", "to"] as const).map((field) => {
                      const problem = field === "from" ? fromProblem : toProblem;
                      return (
                        <div className="field" key={field}>
                          <label htmlFor={`stage-${field}-${stage.key}`}>{text.stages[field]}</label>
                          <select
                            id={`stage-${field}-${stage.key}`}
                            aria-label={field === "from" ? text.stages.fromOf(index + 1) : text.stages.toOf(index + 1)}
                            value={stage[field]}
                            aria-invalid={problem ? true : undefined}
                            aria-describedby={problem ? `stage-${field}-${stage.key}-error` : undefined}
                            onChange={(event) => patch(index, { [field]: Number(event.target.value) })}
                          >
                            {OFFSETS.map((offset) => (
                              <option key={offset} value={offset}>
                                {label(offset)}
                              </option>
                            ))}
                          </select>
                          {problem && (
                            <p className="error" id={`stage-${field}-${stage.key}-error`} role="alert">
                              {problem}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="stage-tools">
                    <button type="button" className="ib" data-tool="up" disabled={index === 0} aria-label={text.stages.up(stage.name || String(index + 1))} onClick={() => move(index, -1)}>
                      <Icon name="up" />
                    </button>
                    <button type="button" className="ib" data-tool="down" disabled={index === list.length - 1} aria-label={text.stages.down(stage.name || String(index + 1))} onClick={() => move(index, 1)}>
                      <Icon name="down" />
                    </button>
                    <button type="button" className="ib" data-tool="remove" disabled={list.length === 1} aria-label={text.stages.remove(stage.name || String(index + 1))} onClick={() => remove(index)}>
                      <Icon name="trash" />
                    </button>
                  </div>
                </fieldset>
              </li>
            );
          })}
        </ol>
        {problems.some((problem) => problem.index === null) && (
          <p className="error" role="alert">
            {text.stages.problem.count}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="secondary" data-tool="add" disabled={!canAddStage(list)} onClick={() => { refocus.current = "last"; setList((current) => addStage(current)); }}>
            <Icon name="plus" />
            {text.stages.add}
          </button>
          <button type="button" className="secondary" data-tool="reset" onClick={() => setList(STAGES.map((stage) => ({ ...stage })))}>
            <Icon name="reset" />
            {text.stages.reset}
          </button>
        </div>
        {!canAddStage(list) && <p className="hint">{text.stages.full}</p>}
        <p className="hint">{text.stages.renameNote}</p>
        {failure.length > 0 && (
          <p className="error" role="alert">
            {failure.join(" ")}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" disabled={busy || !changed} aria-disabled={locked || undefined}>
            {text.stages.save}
          </button>
          {changed && <span className="hint stage-state">{text.stages.changed}</span>}
        </div>
      </form>
    </details>
  );
}
