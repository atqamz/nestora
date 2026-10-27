import { useState } from "react";
import type { BudgetEntryRow } from "../../shared/tables.ts";
import { useOpenRow } from "../hooks/use-open-row.ts";
import { actions, useTable } from "../hooks/use-store.ts";
import { failureOf } from "../ui/failure.ts";
import { ItemDetail } from "../ui/item-detail.tsx";
import { backHref } from "../ui/item-flows.ts";
import { views } from "../ui/registry.ts";
import type { ViewName } from "../ui/registry.ts";
import { DetailTitle } from "../ui/split.tsx";
import { text } from "../ui/text.ts";

export function Gone({ name, id, back, wide = false }: { name: ViewName; id: string; back: string; wide?: boolean }) {
  const [failure, setFailure] = useState<string[]>([]);
  const undo = async () => setFailure(failureOf(await actions.update(views[name].table, id, { deleted_at: null } as never)));
  return (
    <>
      <DetailTitle wide={wide}>{text.gone}</DetailTitle>
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
      <div className="form-actions">
        <button type="button" onClick={undo}>
          {text.undo}
        </button>
        <a className="button secondary" href={back}>
          {text.back}
        </a>
      </div>
    </>
  );
}

export function GenericItem({ name, id }: { name: ViewName; id: string }) {
  const view = views[name];
  const rows = useTable(view.table);
  const lines = useTable("budget_entries");
  const { row, gone } = useOpenRow(rows.find((candidate) => candidate.id === id));
  if (!row) return <Gone name={name} id={id} back={`#/${view.route === "payments" ? "money" : view.route}`} />;
  const line = name === "payment" ? lines.find((candidate) => candidate.id === (row as BudgetEntryRow).budget_id) : undefined;
  const word = name === "payment" ? (line?.title ?? text.nav.money) : text.tasks;
  return <ItemDetail name={name} row={row} gone={gone} back={{ href: backHref(name, row), word }} />;
}
