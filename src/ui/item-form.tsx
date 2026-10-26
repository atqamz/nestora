import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { BudgetEntryRow, ItemRow } from "../../shared/tables.ts";
import { eventKeys } from "../domain/budget.ts";
import { parseField } from "../domain/field.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { usePartner, useStamp } from "../hooks/use-plan.ts";
import { actions, useTable } from "../hooks/use-store.ts";
import type { Written } from "../hooks/use-store.ts";
import { Avatar, Pair } from "./avatar.tsx";
import { failureOf, splitErrors } from "./failure.ts";
import { Field } from "./field.tsx";
import type { Control } from "./field.tsx";
import { fieldLabel, optionLabel } from "./labels.ts";
import { fieldOptions, fieldType, isRequired, views } from "./registry.ts";
import type { View, ViewName } from "./registry.ts";
import { text } from "./text.ts";

type Row = ItemRow | BudgetEntryRow;

type Value = string | number | boolean | null;

const valueOf = (row: Row, field: string) =>
  (field.startsWith("data.") ? (row.data?.[field.slice(5)] ?? null) : (row[field as keyof Row] ?? null)) as Value;

export const backHref = (name: ViewName, row: Row) =>
  name === "payment"
    ? `#/money/${(row as BudgetEntryRow).budget_id}`
    : name === "book" && (row as ItemRow).status === "wish"
      ? "#/wishlist"
      : `#/${views[name].route}`;

type Props = { name: ViewName; row: Row; gone?: boolean; only?: readonly string[]; onRemove?: () => Promise<Written>; onRestore?: () => Promise<Written> };

export function ItemForm({ name, row, gone = false, only, onRemove, onRestore }: Props) {
  const view: View = views[name];
  const [initial] = useState(row);
  const form = useRef<HTMLFormElement>(null);
  const undo = useRef<HTMLButtonElement>(null);
  const removed = useRef(false);
  const revived = useRef(false);
  const notice = useId();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string[]>([]);
  const { busy, once } = useBusy();
  const { label } = usePartner();
  const stamp = useStamp();
  const siblings = useTable(view.table);

  const controls = useMemo(() => {
    const used = new Set(
      (siblings as Row[])
        .filter((other) => ("kind" in other ? other.kind : other.entry_type) === view.variant)
        .flatMap((other) => (other.group_key ? [other.group_key] : [])),
    );
    const names = name === "guest" || name === "vendor";
    const title: Control = { name: "title", label: fieldLabel(name, "title"), type: "text", required: true, value: initial.title, words: names ? true : undefined };
    const rest = (only ?? view.fields).map((field): Control => {
      const options = fieldOptions(name, field);
      const grouped = field === "group_key";
      const events = grouped && name === "planned" ? eventKeys(used, initial.group_key) : null;
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
        words: field === "data.pic" || (grouped && !events) ? true : undefined,
        hint: field === "amount" ? text.amountHint : undefined,
        options: (events ?? options)?.map((value) => ({
          value,
          label: events ? (text.event[value as keyof typeof text.event] ?? value) : optionLabel(name, field, value, label),
          icon: owner ? value === "both" ? <Pair /> : <Avatar side={value === "a" || value === "b" ? value : null} /> : undefined,
        })),
        suggestions: grouped && !events ? [...used] : undefined,
      };
    });
    return [title, ...rest];
  }, [initial, siblings, name, view, only, label]);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return once(() => store(form));
  };

  const store = async (form: FormData) => {
    const change: Record<string, unknown> = {};
    const data: Record<string, unknown> = {};
    const invalid: Record<string, string> = {};
    for (const control of controls) {
      const raw = control.type === "bool" ? form.get(control.name) !== null : String(form.get(control.name) ?? "");
      const parsed = parseField(control.type, raw);
      if (!parsed.ok || (control.name === "title" && parsed.value === null)) {
        invalid[control.name] = control.name === "title" ? text.invalid.required : text.invalid[control.type as "phone" | "int" | "year"];
        continue;
      }
      if (parsed.value === valueOf(initial, control.name)) continue;
      if (control.name.startsWith("data.")) data[control.name.slice(5)] = parsed.value;
      else change[control.name] = parsed.value;
    }
    setErrors(invalid);
    setFailure([]);
    if (Object.keys(invalid).length > 0) return;
    if (view.done !== undefined && "status" in change) change.done_on = change.status === view.done ? stamp() : null;
    if (Object.keys(data).length > 0) change.data = data;
    const result = await actions.update(view.table, row.id, change as never);
    if (result.ok) {
      location.hash = backHref(name, row).slice(1);
      return;
    }
    const { fields, rest } = splitErrors(failureOf(result), controls.map((control) => control.name));
    setErrors(Object.fromEntries(controls.flatMap((control) => (fields[control.name] === undefined ? [] : [[control.name, friendly(control, fields[control.name])]]))));
    setFailure(rest);
  };

  const friendly = (control: Control, message: string) =>
    typeof control.type === "string" ? ((text.invalid as Record<string, string>)[control.type] ?? message) : message;

  useEffect(() => {
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  const restore = () =>
    once(async () => {
      revived.current = true;
      const result = await (onRestore ? onRestore() : actions.update(view.table, row.id, { deleted_at: null } as never));
      if (!result.ok) revived.current = false;
      setFailure(failureOf(result));
    });

  useEffect(() => {
    if (gone || busy || !revived.current) return;
    revived.current = false;
    form.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
  }, [gone, busy]);

  useEffect(() => {
    if (!gone || busy || !removed.current) return;
    removed.current = false;
    undo.current?.focus();
  }, [gone, busy]);

  const remove = () =>
    once(async () => {
      removed.current = true;
      const result = await (onRemove ? onRemove() : actions.remove(view.table, row.id));
      if (!result.ok) removed.current = false;
      setFailure(failureOf(result));
    });

  return (
    <form ref={form} className="form" noValidate onSubmit={save}>
      {controls.map((control) => (
        <Field key={control.name} control={control} error={errors[control.name]} />
      ))}
      <p id={notice} className={gone ? "hint" : "visually-hidden"} role="status">
        {gone ? text.goneOpen : ""}
      </p>
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
      <div className="form-actions">
        {gone && (
          <button ref={undo} type="button" aria-describedby={notice} disabled={busy} onClick={restore}>
            {text.undo}
          </button>
        )}
        <button type="submit" disabled={busy || gone}>
          {text.save}
        </button>
        <a className="button secondary" href={backHref(name, row)}>
          {text.cancel}
        </a>
        <button type="button" className="danger" disabled={busy || gone} onClick={remove}>
          {text.delete}
        </button>
      </div>
    </form>
  );
}
