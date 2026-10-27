import { useTable } from "../hooks/use-store.ts";
import { useOpenRow } from "../hooks/use-open-row.ts";
import { Contact } from "../ui/contact.tsx";
import { ItemDetail } from "../ui/item-detail.tsx";
import { views } from "../ui/registry.ts";
import { text } from "../ui/text.ts";
import { Gone } from "./generic-item.tsx";

export type Kind = "guest" | "vendor";

export function Person({ id, kind, wide }: { id: string; kind: Kind; wide: boolean }) {
  const rows = useTable("items");
  const { row, gone } = useOpenRow(rows.find((candidate) => candidate.id === id && candidate.kind === kind));
  const back = `#/${views[kind].route}`;
  if (!row) return <Gone name={kind} id={id} back={back} wide={wide} />;
  const phone = typeof row.data?.phone === "string" ? row.data.phone : null;
  return (
    <ItemDetail
      name={kind}
      row={row}
      gone={gone}
      wide={wide}
      back={{ href: back, word: text.contacts[kind === "guest" ? "guests" : "vendors"] }}
      head={
        <p className="kicker">
          {text.contacts[kind]} · {row.group_key ?? text.contacts.noGroup}
        </p>
      }
      skip={["group_key", "data.phone"]}
    >
      {phone ? <Contact phone={phone} title={row.title} call labelled /> : <p className="hint">{text.contacts.noPhone}</p>}
    </ItemDetail>
  );
}
