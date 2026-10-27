import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { EVENT_ORDER, eventKeys } from "../domain/budget.ts";
import { draftFor, parseAmount } from "../domain/draft.ts";
import type { Field as Parsed, Kind } from "../domain/draft.ts";
import { sortBefore } from "../domain/order.ts";
import { normalizePhone } from "../domain/phone.ts";
import { routeOf } from "../domain/stages.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { usePartner, useSettings, useToday } from "../hooks/use-plan.ts";
import { actions, useTable } from "../hooks/use-store.ts";
import { useWriteLock } from "../hooks/use-write-lock.ts";
import { Avatar, Pair } from "./avatar.tsx";
import { BookFields, useBookForm } from "./book-sheet.tsx";
import { DETAILS, problemsOf } from "./add-problems.ts";
import type { Detail } from "./add-problems.ts";
import { failureOf } from "./failure.ts";
import { Field } from "./field.tsx";
import type { Control } from "./field.tsx";
import { formatDay, formatMoney } from "./format.ts";
import { Icon } from "./icons.tsx";
import type { IconName } from "./icons.tsx";
import { overlay, useOverlay, withSeed } from "./overlay.ts";
import { PausedNote, lockedProps } from "./paused-note.tsx";
import { text } from "./text.ts";
import { useSheet } from "./use-sheet.ts";

type Owner = "a" | "b" | "both" | "none";

const KINDS: readonly Kind[] = ["task", "planned", "payment", "guest", "vendor", "book"];

const KIND_ICON: Record<Kind, IconName> = { task: "task", planned: "money", payment: "receipt", guest: "people", vendor: "shop", book: "book" };

const DETAIL_ICON: Record<Detail, IconName> = { amount: "receipt", due: "calendar", line: "money", group: "flag", phone: "call", qty: "people" };

const READ_AS: Partial<Record<Detail, Parsed>> = { amount: "amount", due: "due", phone: "phone" };

const OWNER_KINDS: readonly Kind[] = ["task", "payment", "guest"];

const without = <T,>(set: ReadonlySet<T>, value: T) => new Set([...set].filter((entry) => entry !== value));

function AddForm({ seed }: { seed: string }) {
  const settings = useSettings();
  const today = useToday();
  const { me, label } = usePartner();
  const items = useTable("items");
  const entries = useTable("budget_entries");
  const { busy, once } = useBusy();
  const { locked } = useWriteLock();
  const ids = useId();
  const form = useRef<HTMLFormElement>(null);

  const [start] = useState(overlay.keptDraft);
  const [input, setInput] = useState(() => withSeed(start?.input ?? "", seed));
  const [kindPick, setKindPick] = useState<Kind | null>(start?.kindPick ?? null);
  const [ignore, setIgnore] = useState<ReadonlySet<Parsed>>(new Set(start?.ignore));
  const [edits, setEdits] = useState<Partial<Record<Detail, string>>>((start?.edits ?? {}) as Partial<Record<Detail, string>>);
  const [ownerPick, setOwnerPick] = useState<Owner | null>((start?.ownerPick ?? null) as Owner | null);
  const [open, setOpen] = useState<Detail | "owner" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<string[]>([]);

  const lines = useMemo(
    () =>
      entries
        .filter((entry) => entry.entry_type === "planned")
        .map((entry) => ({
          id: entry.id,
          title: entry.title,
          currency: entry.currency,
          vendor: items.find((item) => item.id === entry.vendor_id)?.title ?? null,
        })),
    [entries, items],
  );

  const { draft, kind } = useMemo(
    () => draftFor(input, { today, me, nicknames: { a: settings.partnerA, b: settings.partnerB }, lines }, ignore, kindPick),
    [input, today, me, settings.partnerA, settings.partnerB, lines, ignore, kindPick],
  );

  const book = useBookForm("wish", draft.title, setInput, kind === "book");

  const phase = useMemo(() => {
    if (settings.ceremonyDate === null) return "";
    return routeOf(settings.ceremonyDate, today, [], settings.stages).find((station) => station.state === "now")?.name ?? "";
  }, [settings.ceremonyDate, settings.stages, today]);

  const used = (name: "items" | "budget_entries", variant: string) => {
    const rows = (name === "items" ? items : entries) as { kind?: string; entry_type?: string; group_key: string | null }[];
    return [...new Set(rows.filter((row) => (row.kind ?? row.entry_type) === variant).flatMap((row) => (row.group_key ? [row.group_key] : [])))];
  };

  const values: Record<Detail, string> = {
    amount: draft.amount === null ? "" : String(draft.amount),
    due: draft.due ?? "",
    line: draft.line ?? "",
    phone: draft.phone ?? "",
    group: kind === "task" ? phase : kind === "planned" ? EVENT_ORDER[2] : "",
    qty: "1",
    ...edits,
  };

  const ownerAllowed = (owner: Owner) => kind !== "guest" || owner !== "both";
  const parsedOwner: Owner | null = draft.who !== null && ownerAllowed(draft.who) ? draft.who : null;
  const owner: Owner = ownerPick !== null && ownerAllowed(ownerPick) ? ownerPick : (parsedOwner ?? me ?? "none");

  const amount = values.amount.trim() === "" ? null : parseAmount(values.amount);
  const quantity = /^\d+$/.test(values.qty.trim()) ? Number(values.qty.trim()) : Number.NaN;

  const problems = problemsOf(kind, draft.title, values, lines);
  const shown = attempt > 0 ? problems : {};

  useEffect(() => {
    if (open !== null) form.current?.querySelector<HTMLElement>(".editor input:not([type=radio]), .editor select, .editor textarea, .editor button")?.focus();
  }, [open]);

  useEffect(() => {
    if (attempt > 0) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  const edit = (detail: Detail) => (value: string) => setEdits((current) => ({ ...current, [detail]: value }));

  const putBack = (detail: Detail | "owner") => {
    const parsed = detail === "owner" ? "who" : READ_AS[detail];
    if (parsed === undefined) return;
    setIgnore((current) => new Set([...current, parsed]));
    if (detail === "owner") setOwnerPick(null);
    else setEdits((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== detail)));
    setOpen(null);
  };

  const groupControl = (): Control => {
    const base = { name: "group", label: text.sheet.group[kind as keyof typeof text.sheet.group], value: values.group, onChange: edit("group") };
    if (kind === "task") {
      const names = [...new Set([...settings.stages.map((stage) => stage.name), ...(values.group === "" ? [] : [values.group])])];
      return { ...base, type: "text", options: names.map((value) => ({ value, label: value })), blank: text.sheet.none.group };
    }
    if (kind === "planned") {
      const keys = eventKeys(used("budget_entries", "planned"), values.group === "" ? null : values.group);
      return { ...base, type: "text", required: true, options: keys.map((value) => ({ value, label: text.event[value as keyof typeof text.event] ?? value })) };
    }
    return { ...base, type: "text", words: true, suggestions: used("items", kind) };
  };

  const control = (detail: Detail): Control => {
    switch (detail) {
      case "amount":
        return { name: "amount", label: text.sheet.detail.amount, type: "int", value: values.amount, hint: text.amountHint, onChange: edit("amount") };
      case "due":
        return { name: "due", label: text.sheet.detail.due, type: "date", value: values.due, onChange: edit("due") };
      case "line":
        return {
          name: "line",
          label: text.sheet.detail.line,
          type: "text",
          value: values.line,
          options: lines.map((line) => ({ value: line.id, label: line.title })),
          blank: text.sheet.none.line,
          onChange: edit("line"),
        };
      case "phone":
        return { name: "phone", label: text.sheet.detail.phone, type: "phone", value: values.phone, onChange: edit("phone") };
      case "qty":
        return { name: "qty", label: text.sheet.detail.qty, type: "int", value: values.qty, onChange: edit("qty") };
      case "group":
        return groupControl();
    }
  };

  const chipText = (detail: Detail): string => {
    const raw = values[detail].trim();
    if (detail === "amount") return raw === "" ? text.sheet.none.amount : amount === null ? raw : formatMoney(amount);
    if (detail === "due") return raw === "" ? text.sheet.none.due : formatDay(raw, today);
    if (detail === "line") return lines.find((line) => line.id === raw)?.title ?? text.sheet.none.line;
    if (detail === "phone") return raw === "" ? text.sheet.none.phone : (normalizePhone(raw) ?? raw);
    if (detail === "qty") return Number.isInteger(quantity) && quantity >= 1 ? text.people(quantity) : raw;
    return raw === "" ? text.sheet.none.group : (text.event[raw as keyof typeof text.event] ?? raw);
  };

  const ownerControl: Control = {
    name: "owner",
    label: text.sheet.owner[kind as keyof typeof text.sheet.owner],
    type: "text",
    required: true,
    choice: true,
    value: owner,
    onChange: (value) => setOwnerPick(value as Owner),
    options: [
      { value: "a", label: label("a"), icon: <Avatar side="a" /> },
      { value: "b", label: label("b"), icon: <Avatar side="b" /> },
      ...(kind === "guest" ? [] : [{ value: "both", label: text.both, icon: <Pair /> }]),
      { value: "none", label: text.nobody, icon: <Avatar side={null} /> },
    ],
  };

  const create = async () => {
    const side = owner === "none" ? null : owner;
    const phone = values.phone.trim() === "" ? undefined : { phone: normalizePhone(values.phone)! };
    const line = lines.find((candidate) => candidate.id === values.line);
    const group = values.group.trim() === "" ? null : values.group.trim();
    const due = values.due === "" ? null : values.due;
    switch (kind) {
      case "book":
        return book.save();
      case "task":
        return actions.create("items", { kind: "task", title: draft.title, status: "todo", due_on: due, who: side, amount, group_key: group, sort: sortBefore(items.filter((item) => item.kind === "task")) });
      case "planned":
        return actions.create("budget_entries", { entry_type: "planned", title: draft.title, group_key: group ?? EVENT_ORDER[2], amount, sort: sortBefore(entries.filter((entry) => entry.entry_type === "planned")) });
      case "payment":
        return actions.create("budget_entries", {
          entry_type: "payment",
          title: draft.title || line!.title,
          budget_id: line!.id,
          status: "due",
          amount: amount!,
          currency: line!.currency,
          due_on: due,
          who: side,
          sort: entries.filter((entry) => entry.entry_type === "payment" && entry.budget_id === line!.id).length,
        });
      case "guest":
        return actions.create("items", {
          kind: "guest",
          title: draft.title,
          status: "todo",
          who: side === "a" || side === "b" ? side : null,
          qty: quantity,
          group_key: group,
          ...(phone ? { data: phone } : {}),
          sort: sortBefore(items.filter((item) => item.kind === "guest")),
        });
      case "vendor":
        return actions.create("items", { kind: "vendor", title: draft.title, status: "option", group_key: group, amount, ...(phone ? { data: phone } : {}), sort: sortBefore(items.filter((item) => item.kind === "vendor")) });
    }
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked) return;
    setAttempt((count) => count + 1);
    if (kind === "book") book.reveal();
    const first = (Object.keys(problems) as (Detail | "title")[]).find((name) => name !== "title");
    if (Object.keys(problems).length > 0 || (kind === "book" && !book.valid)) {
      setOpen(problems.title ? null : (first ?? null));
      return;
    }
    return once(async () => {
      const result = await create();
      setFailure(failureOf(result));
      if (!result.ok) return;
      overlay.keepDraft(null);
      overlay.announce(text.sheet.added(draft.title || (lines.find((line) => line.id === values.line)?.title ?? "")));
      overlay.closeAdd();
    });
  };

  const pristine = input === "" && Object.keys(edits).length === 0 && kindPick === null && ownerPick === null;

  useEffect(() => {
    overlay.keepDraft(pristine ? null : { input, kindPick, ignore: [...ignore], edits: edits as Record<string, string>, ownerPick });
  }, [pristine, input, kindPick, ignore, edits, ownerPick]);

  const read = draft.title !== "" && draft.title !== input.trim().replace(/\s+/g, " ");
  const fieldName = (detail: Detail) => (detail === "group" ? text.sheet.group[kind as keyof typeof text.sheet.group] : text.sheet.detail[detail]);
  const chips: { key: Detail | "owner"; icon: IconName; field: string; label: string; invalid: boolean }[] = [
    ...DETAILS[kind].map((detail) => ({ key: detail, icon: DETAIL_ICON[detail], field: fieldName(detail), label: chipText(detail), invalid: shown[detail] !== undefined })),
    ...(parsedOwner !== null && ownerPick === null ? [{ key: "owner" as const, icon: "people" as const, field: text.sheet.detail.owner, label: label(parsedOwner), invalid: false }] : []),
  ];
  const canPutBack = (key: Detail | "owner") => (key === "owner" ? parsedOwner !== null && ownerPick === null : READ_AS[key] !== undefined && !(key in edits) && draft[key as "amount" | "due" | "phone"] !== null);
  const editing = open === null || open === "owner" ? null : control(open);

  return (
    <form ref={form} className="sheet-form" noValidate onSubmit={save} data-pristine={pristine || undefined}>
      <div className="sheet-head">
        <h2 id="sheet-title">{text.sheet.title}</h2>
        <button type="button" className="ib" aria-label={text.sheet.close} onClick={overlay.closeAdd}>
          <Icon name="close" />
        </button>
      </div>
      <div className="sheet-body">
        <PausedNote />
        <div role="group" aria-label={text.sheet.kind} className="kinds">
          {KINDS.map((name) => (
            <button key={name} type="button" aria-pressed={kind === name} onClick={() => setKindPick(name)}>
              <Icon name={KIND_ICON[name]} />
              {text.sheet.kinds[name]}
            </button>
          ))}
        </div>
        <div className="cap">
          <label htmlFor={`${ids}-first`} className="visually-hidden">
            {text.sheet.first[kind]}
          </label>
          <input
            id={`${ids}-first`}
            name="title"
            data-first
            value={input}
            maxLength={500}
            autoComplete="off"
            autoCapitalize={kind === "guest" || kind === "vendor" ? "words" : "sentences"}
            enterKeyHint="done"
            placeholder={text.sheet.placeholder[kind]}
            aria-invalid={shown.title ? true : undefined}
            aria-describedby={shown.title ? `${ids}-title-error` : undefined}
            onChange={(event) => setInput(event.target.value)}
          />
          {shown.title && (
            <p className="error cap-error" id={`${ids}-title-error`} role="alert">
              {shown.title}
            </p>
          )}
        </div>
        <p className="visually-hidden" role="status">
          {text.sheet.kinds[kind]}
        </p>
        {read && <p className="saved-as">{text.sheet.savedAs(draft.title)}</p>}
        {kind === "book" && <BookFields form={book} />}
        {kind === "book" && (
          <a className="button secondary imp-link" href="#/books/import">
            <Icon name="upload" />
            {text.books.import.open}
          </a>
        )}
        {kind !== "book" && (
          <ul className="chips" aria-label={text.sheet.chips}>
            {chips.map((chip) => (
              <li key={chip.key}>
                <button type="button" className="chip" aria-label={text.sheet.chipName(chip.field, chip.label)} aria-expanded={open === chip.key} data-invalid={chip.invalid || undefined} data-empty={chipEmpty(chip.key, values) || undefined} onClick={() => setOpen(open === chip.key ? null : chip.key)}>
                  <Icon name={chip.icon} />
                  <span>{chip.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {open === "owner" && parsedOwner !== null && (
          <div className="editor">
            <p className="hint">{text.sheet.ownerRead(label(parsedOwner))}</p>
            <button type="button" className="secondary" onClick={() => putBack("owner")}>
              {text.sheet.putBack}
            </button>
          </div>
        )}
        {editing && (
          <div className="editor">
            <Field key={editing.name} control={editing} error={shown[open as Detail]} />
            {open !== null && open !== "owner" && canPutBack(open) && (
              <button type="button" className="secondary" onClick={() => putBack(open)}>
                {text.sheet.putBack}
              </button>
            )}
          </div>
        )}
        {OWNER_KINDS.includes(kind) && <Field control={ownerControl} />}
        {failure.length > 0 && (
          <p className="error" role="alert">
            {failure.join(" ")}
          </p>
        )}
      </div>
      <div className="sheet-foot">
        <button type="submit" disabled={busy} {...lockedProps(locked)}>
          {kind === "book" ? book.saveLabel : text.sheet.save[kind]}
        </button>
        <p className="hint sheet-hint">{kind === "book" ? text.sheet.hintBook : text.sheet.hint}</p>
      </div>
    </form>
  );
}

const chipEmpty = (key: Detail | "owner", values: Record<Detail, string>) => key !== "owner" && values[key].trim() === "";

export function AddSheet() {
  const { adding, seed, session } = useOverlay();
  const dialog = useRef<HTMLDialogElement>(null);

  useSheet(dialog, adding, overlay.closeAdd);

  useEffect(() => {
    const element = dialog.current!;
    if (adding && !element.open) {
      element.showModal();
      element.querySelector<HTMLElement>("[data-first]")?.focus();
    } else if (!adding && element.open) element.close();
  }, [adding, session]);

  return (
    <dialog
      ref={dialog}
      className="add-sheet"
      aria-labelledby="sheet-title"
      onClose={(event) => {
        if (event.target !== event.currentTarget) return;
        overlay.closeAdd();
        overlay.returnFocus();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && event.currentTarget.querySelector("[data-pristine]")) overlay.closeAdd();
      }}
    >
      {adding && <AddForm key={session} seed={seed} />}
    </dialog>
  );
}
