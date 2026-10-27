import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { BudgetEntryRow, ItemRow } from "../../shared/tables.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { actions, useTable } from "../hooks/use-store.ts";
import type { Written } from "../hooks/use-store.ts";
import { Avatar, Pair } from "./avatar.tsx";
import { changeOf, valueOf } from "./edit-change.ts";
import { failureOf, splitErrors } from "./failure.ts";
import { Field } from "./field.tsx";
import type { Control } from "./field.tsx";
import { fieldLabel, optionLabel } from "./labels.ts";
import { Modal } from "./modal.tsx";
import { fieldOptions, fieldType, isRequired, views } from "./registry.ts";
import type { ViewName } from "./registry.ts";
import { text } from "./text.ts";

type Row = ItemRow | BudgetEntryRow;

const friendly = (control: Control, message: string) =>
  typeof control.type === "string" ? ((text.invalid as Record<string, string>)[control.type] ?? message) : message;

type Props = { name: ViewName; row: Row; gone: boolean; title: string; only?: readonly string[]; onClose: () => void; onRestore: () => Promise<Written> };

export function EditSheet({ name, row, gone, title, only, onClose, onRestore }: Props) {
  const view = views[name];
  const [initial] = useState(row);
  const body = useRef<HTMLDivElement>(null);
  const revived = useRef(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string[]>([]);
  const { busy, once } = useBusy();
  const { label } = usePartner();
  const siblings = useTable(view.table);

  const controls = useMemo(() => {
    const used = new Set(
      (siblings as Row[])
        .filter((other) => ("kind" in other ? other.kind : other.entry_type) === view.variant)
        .flatMap((other) => (other.group_key ? [other.group_key] : [])),
    );
    const names = name === "guest" || name === "vendor";
    const first: Control = { name: "title", label: fieldLabel(name, "title"), type: "text", required: true, value: initial.title, words: names ? true : undefined };
    const rest = (only ?? view.fields).map((field): Control => {
      const options = fieldOptions(name, field);
      const grouped = field === "group_key";
      const owner = field === "who";
      return {
        name: field,
        label: fieldLabel(name, field),
        type: fieldType(name, field),
        value: valueOf(initial, field),
        required: isRequired(name, field),
        blank: owner ? text.nobody : text.notSet,
        blankIcon: owner ? <Avatar side={null} /> : undefined,
        choice: owner || field === "status" ? true : undefined,
        words: field === "data.pic" || grouped ? true : undefined,
        hint: field === "amount" ? text.amountHint : undefined,
        options: options?.map((value) => ({
          value,
          label: optionLabel(name, field, value, label),
          icon: owner ? value === "both" ? <Pair /> : <Avatar side={value === "a" || value === "b" ? value : null} /> : undefined,
        })),
        suggestions: grouped ? [...used] : undefined,
      };
    });
    return [first, ...rest];
  }, [initial, siblings, name, view, only, label]);

  const store = async (form: FormData) => {
    const { change, invalid } = changeOf(controls, form, initial);
    setErrors(invalid);
    setFailure([]);
    if (Object.keys(invalid).length > 0) return;
    const result = Object.keys(change).length === 0 ? ({ ok: true, id: row.id } as const) : await actions.update(view.table, row.id, change as never);
    if (result.ok) return onClose();
    const { fields, rest } = splitErrors(failureOf(result), controls.map((control) => control.name));
    setErrors(Object.fromEntries(controls.flatMap((control) => (fields[control.name] === undefined ? [] : [[control.name, friendly(control, fields[control.name])]]))));
    setFailure(rest);
  };

  useEffect(() => {
    body.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  useEffect(() => {
    if (gone || busy || !revived.current) return;
    revived.current = false;
    body.current?.querySelector<HTMLElement>("input")?.focus();
  }, [gone, busy]);

  const restore = () =>
    once(async () => {
      revived.current = true;
      const result = await onRestore();
      if (!result.ok) revived.current = false;
      setFailure(failureOf(result));
    });

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        return once(() => store(form));
      }}
      foot={
        <>
          {gone && (
            <button type="button" className="secondary" disabled={busy} onClick={restore}>
              {text.undo}
            </button>
          )}
          <button type="submit" disabled={busy || gone}>
            {text.save}
          </button>
        </>
      }
    >
      <div className="form bk-form" ref={body}>
        {controls.map((control) => (
          <Field key={control.name} control={control} error={errors[control.name]} />
        ))}
        <p className={gone ? "hint" : "visually-hidden"} role="status">
          {gone ? text.goneOpen : ""}
        </p>
        {failure.length > 0 && (
          <p className="error" role="alert">
            {failure.join(" ")}
          </p>
        )}
      </div>
    </Modal>
  );
}
