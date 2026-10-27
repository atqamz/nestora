import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useBusy } from "../hooks/use-busy.ts";
import { usePartner, useStamp } from "../hooks/use-plan.ts";
import { useWriteLock } from "../hooks/use-write-lock.ts";
import { actions } from "../hooks/use-store.ts";
import type { Written } from "../hooks/use-store.ts";
import { failureOf } from "./failure.ts";
import { Icon } from "./icons.tsx";
import { ItemForm } from "./item-form.tsx";
import { factsOf, hostOf } from "./item-facts.ts";
import { instantChange, instantFields, instantValue, removeItem, restoreItem, sheetFields } from "./item-flows.ts";
import type { Row } from "./item-flows.ts";
import { fieldLabel, optionLabel } from "./labels.ts";
import { Menu } from "./menu.tsx";
import { Money } from "./money.tsx";
import { fieldOptions, views } from "./registry.ts";
import type { ViewName } from "./registry.ts";
import { DetailTitle } from "./split.tsx";
import { text } from "./text.ts";
import { Title } from "./title.tsx";

type Props = {
  name: ViewName;
  row: Row;
  gone: boolean;
  back: { href: string; word: string };
  wide?: boolean;
  head?: ReactNode;
  cover?: ReactNode;
  sheet?: readonly string[];
  flows?: { remove: () => Promise<Written>; restore: () => Promise<Written> };
  skip?: readonly string[];
  details?: false;
  children?: ReactNode;
};

function Instant({ name, row }: { name: ViewName; row: Row }) {
  const { label } = usePartner();
  const stamp = useStamp();
  const { once } = useBusy();
  const { locked, guard } = useWriteLock();
  const [failure, setFailure] = useState<string[]>([]);
  const id = useId();
  const set = (field: "status" | "who", value: string) =>
    once(async () => {
      const change = instantChange(name, row, field, value, stamp());
      if (change) setFailure(failureOf(await actions.update(views[name].table, row.id, change as never)));
    });
  return (
    <>
      {instantFields(name).map((field) => {
        const options = [...(field === "who" ? [{ value: "", label: text.nobody }] : []), ...(fieldOptions(name, field) ?? []).map((value) => ({ value, label: optionLabel(name, field, value, label) }))];
        const now = instantValue(row, field);
        return (
          <div key={field} className="instant">
            <p className="hint" id={`${id}-${field}`}>
              {fieldLabel(name, field)}
            </p>
            <div role="group" aria-labelledby={`${id}-${field}`} className="seg">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={now === option.value}
                  aria-disabled={locked || undefined}
                  onClick={guard(() => void set(field, option.value))}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
    </>
  );
}

function Facts({ name, row, skip }: { name: ViewName; row: Row; skip: readonly string[] }) {
  const { label } = usePartner();
  const facts = factsOf(name, row, [...skip, ...instantFields(name)], label);
  if (facts.length === 0) return null;
  return (
    <dl className="nums detail-facts">
      {facts.map((fact) => (
        <div key={fact.field} data-long={fact.kind === "long" || undefined}>
          <dt>{fact.label}</dt>
          <dd>
            {fact.kind === "money" ? (
              <Money rupiah={Number(fact.value)} />
            ) : fact.kind === "link" ? (
              <a href={String(fact.value)} aria-label={`${fact.label}: ${hostOf(String(fact.value))}`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
                {hostOf(String(fact.value))
                  .split(".")
                  .flatMap((label, at) => (at === 0 ? [label] : [".", <wbr key={at} />, label]))}
              </a>
            ) : (
              fact.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ItemDetail({ name, row, gone, back, wide, head, cover, sheet, flows, skip = [], details, children }: Props) {
  const [editing, setEditing] = useState<readonly string[] | false>(false);
  const { busy, once } = useBusy();
  const { locked, guard } = useWriteLock();
  const [failure, setFailure] = useState<string[]>([]);
  const edit = useRef<HTMLButtonElement>(null);
  const revived = useRef(false);
  const notice = "item-gone";

  useEffect(() => {
    if (gone || !revived.current) return;
    revived.current = false;
    edit.current?.focus();
  }, [gone]);

  const restore = () =>
    once(async () => {
      revived.current = true;
      const result = await (flows ? flows.restore() : restoreItem(actions, name, row));
      if (!result.ok) revived.current = false;
      setFailure(failureOf(result));
    });

  const remove = () =>
    void once(async () =>
      setFailure(failureOf(await (flows ? flows.remove() : removeItem({ actions, go: (hash) => void (location.hash = hash) }, name, row)))),
    );

  return (
    <>
      {!wide && (
        <p className="trail">
          <a href={back.href}>
            <Icon name="back" />
            {back.word}
          </a>
        </p>
      )}
      {cover ? (
        <div className="bk-head">
          {cover}
          <div className="bk-id">
            <Title>{row.title}</Title>
            {head}
          </div>
        </div>
      ) : (
        <>
          {wide === undefined ? <Title>{row.title}</Title> : <DetailTitle wide={wide}>{row.title}</DetailTitle>}
          {head}
        </>
      )}
      <p id={notice} className={gone && !editing ? "hint" : "visually-hidden"} role="status">
        {gone && !editing ? text.gone : ""}
      </p>
      {gone && !editing && (
        <p>
          <button type="button" className="secondary" aria-describedby={notice} disabled={busy} onClick={restore}>
            {text.undo}
          </button>
        </p>
      )}
      <div inert={gone}>
        <div className="detail-tools">
          <button ref={edit} type="button" className="secondary" aria-label={text.editNamed(row.title)} aria-disabled={locked || undefined} onClick={guard(() => setEditing(sheet ?? sheetFields(name)))}>
            <Icon name="edit" />
            {text.edit}
          </button>
          <Menu name={text.menu.moreNamed(row.title)} items={[{ id: "delete", icon: "trash", label: text.delete, danger: true, locked, run: guard(remove) }]} />
        </div>
        {failure.length > 0 && (
          <p className="error" role="alert">
            {failure.join(" ")}
          </p>
        )}
        <Instant name={name} row={row} />
        {details !== false && <Facts name={name} row={row} skip={skip} />}
        {children}
      </div>
      {editing && <ItemForm key={row.id} name={name} row={row} gone={gone} only={editing} sheet={() => setEditing(false)} />}
    </>
  );
}
