import { useState } from "react";
import type { MenuItem } from "../domain/menu.ts";
import { useBusy } from "../hooks/use-busy.ts";
import type { Written } from "../hooks/use-store.ts";
import { failureOf } from "./failure.ts";
import { Icon } from "./icons.tsx";
import { Menu } from "./menu.tsx";
import { text } from "./text.ts";

type Props = { title: string; gone: boolean; onEdit: () => void; onRestore: () => Promise<Written>; remove: () => Promise<Written> };

export function DetailTools({ title, gone, onEdit, onRestore, remove }: Props) {
  const { busy, once } = useBusy();
  const [failure, setFailure] = useState<string[]>([]);
  const run = (work: () => Promise<Written>, refocus?: true) => () =>
    void once(async () => {
      const result = await work();
      setFailure(failureOf(result));
      if (result.ok && refocus) document.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    });
  const items: MenuItem[] = [{ id: "delete", icon: "trash", label: text.delete, danger: true, run: run(remove) }];
  return (
    <>
      {gone ? (
        <div className="detail-tools">
          <p className="hint" role="status">
            {text.frame.goneRead}
          </p>
          <button type="button" disabled={busy} onClick={run(onRestore, true)}>
            {text.undo}
          </button>
        </div>
      ) : (
        <div className="detail-tools">
          <button type="button" className="secondary" aria-label={text.frame.editNamed(title)} onClick={onEdit}>
            <Icon name="edit" />
            {text.frame.edit}
          </button>
          <Menu name={text.frame.moreNamed(title)} items={items} />
        </div>
      )}
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
    </>
  );
}
