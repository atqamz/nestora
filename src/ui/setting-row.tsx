import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useBusy } from "../hooks/use-busy.ts";
import { useWriteLock } from "../hooks/use-write-lock.ts";
import { Field } from "./field.tsx";
import type { Control } from "./field.tsx";
import { Icon } from "./icons.tsx";
import { text } from "./text.ts";

type Props = {
  field: Control;
  kicker: string;
  shown: ReactNode;
  notes?: ReactNode;
  lead?: ReactNode;
  what: string;
  save: (value: string) => Promise<string | null>;
};

export function SettingRow({ field, kicker, shown, notes, lead, what, save }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const { busy, once } = useBusy();
  const { locked, hold } = useWriteLock();
  const button = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const returning = useRef(false);

  useEffect(() => {
    if (editing) form.current?.querySelector<HTMLElement>("input, select")?.focus();
    else if (returning.current) {
      returning.current = false;
      button.current?.focus();
    }
  }, [editing]);

  const close = () => {
    returning.current = true;
    setEditing(false);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked) return hold();
    return once(async () => {
      const problem = await save(draft.trim());
      if (problem === null) close();
      else setError(problem);
    });
  };

  if (editing) {
    return (
      <li className="set-edit">
        <form
          ref={form}
          className="form set-form"
          noValidate
          onSubmit={submit}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        >
          <Field control={{ ...field, value: draft, onChange: setDraft }} error={error} />
          <div className="form-actions">
            <button type="submit" disabled={busy} aria-disabled={locked || undefined} aria-label={text.settings.save(what)}>
              {text.save}
            </button>
            <button type="button" className="secondary" aria-label={text.settings.cancel(what)} onClick={close}>
              {text.cancel}
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li>
      {lead}
      <span className="v">
        <small className="k">{kicker}</small>
        {shown}
        {notes}
      </span>
      <button
        ref={button}
        type="button"
        className="ib"
        aria-label={text.settings.change(what)}
        onClick={() => {
          setDraft(String(field.value ?? ""));
          setError(undefined);
          setEditing(true);
        }}
      >
        <Icon name="edit" />
      </button>
    </li>
  );
}
