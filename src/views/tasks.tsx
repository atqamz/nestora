import { useMemo } from "react";
import { bySort } from "../domain/order.ts";
import { useTable } from "../hooks/use-store.ts";
import { ItemLine } from "../ui/item-line.tsx";
import { MarriageTabs } from "../ui/marriage-tabs.tsx";
import { QuickAdd } from "../ui/quick-add.tsx";
import { statusRank } from "../ui/registry.ts";
import { text } from "../ui/text.ts";
import { Title } from "../ui/title.tsx";

export function Tasks() {
  const items = useTable("items");
  const rows = useMemo(
    () => items.filter((item) => item.kind === "task").sort((a, b) => statusRank("task", a.status) - statusRank("task", b.status) || bySort(a, b)),
    [items],
  );

  return (
    <>
      <Title>{text.tasks}</Title>
      <MarriageTabs screen="tasks" />
      <QuickAdd name="task" />
      {rows.length === 0 ? (
        <p className="empty">{text.empty.task}</p>
      ) : (
        <ul className="rows">
          {rows.map((row) => (
            <ItemLine key={row.id} name="task" row={row} />
          ))}
        </ul>
      )}
    </>
  );
}
