import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { COLLECTION_MAX } from "../../shared/tables.ts";
import type { Collection } from "../domain/collection.ts";
import type { ScreenKind } from "../domain/screen.ts";
import { actions, readItems } from "../hooks/use-store.ts";
import { moveMember, renameCollection } from "./collection-flows.ts";
import { failureOf } from "./failure.ts";
import { Field } from "./field.tsx";
import { Icon } from "./icons.tsx";
import { Modal } from "./modal.tsx";
import { ScreenRow } from "./screen-row.tsx";
import { text } from "./text.ts";

const words = text.screen.collection;

const deps = { items: readItems, actions };

function Rename({ kind, group, onClose }: { kind: ScreenKind; group: Collection; onClose: () => void }) {
  const [name, setName] = useState(group.name);
  const [failure, setFailure] = useState<string[]>([]);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await renameCollection(deps, kind, group.name, name);
    setFailure(failureOf(result));
    if (result.ok) onClose();
  };
  return (
    <Modal
      title={words.renameTitle}
      onClose={onClose}
      onSubmit={save}
      foot={<button type="submit">{words.renameSave}</button>}
    >
      <div className="form bk-form">
        <Field control={{ name: "collection", label: words.renameLabel, type: "text", words: true, required: true, max: COLLECTION_MAX, value: name, onChange: setName }} error={failure[0]} />
      </div>
    </Modal>
  );
}

export function CollectionSection({ kind, group }: { kind: ScreenKind; group: Collection }) {
  const heading = useId();
  const section = useRef<HTMLElement>(null);
  const moved = useRef<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [failure, setFailure] = useState<string[]>([]);
  const order = group.rows.map((row) => row.id).join();

  useEffect(() => {
    const pressed = moved.current;
    if (pressed === null) return;
    moved.current = null;
    const [way, id] = pressed.split(":");
    const find = (name: string) => section.current?.querySelector<HTMLButtonElement>(`[data-move="${name}:${id}"]`);
    const target = find(way);
    (target && !target.disabled ? target : find(way === "up" ? "down" : "up"))?.focus();
  }, [order]);

  return (
    <section ref={section} aria-labelledby={heading}>
      <div className="co-h">
        <h2 id={heading}>
          {group.name} <span className="tally">{group.rows.length}</span>
        </h2>
        <button type="button" className="ib" aria-label={words.rename(group.name)} onClick={() => setRenaming(true)}>
          <Icon name="edit" />
        </button>
      </div>
      <ol className="rows">
        {group.rows.map((row, index) => (
          <ScreenRow
            key={row.id}
            row={row}
            kind={kind}
            member={{
              position: index + 1,
              next: row.id === group.next,
              first: index === 0,
              last: index === group.rows.length - 1,
              onMove: (step) => {
                moved.current = `${step < 0 ? "up" : "down"}:${row.id}`;
                void moveMember(deps, kind, row, step).then((result) => {
                  if (!result.ok) moved.current = null;
                  setFailure(failureOf(result));
                });
              },
            }}
          />
        ))}
      </ol>
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
      {renaming && <Rename kind={kind} group={group} onClose={() => setRenaming(false)} />}
    </section>
  );
}
