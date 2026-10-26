import { useTable } from "../hooks/use-store.ts";
import { useOpenRow } from "../hooks/use-open-row.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { Who } from "../ui/avatar.tsx";
import { Contact } from "../ui/contact.tsx";
import { ItemForm } from "../ui/item-form.tsx";
import { optionLabel } from "../ui/labels.ts";
import { Money } from "../ui/money.tsx";
import { views } from "../ui/registry.ts";
import { DetailTitle } from "../ui/split.tsx";
import { text } from "../ui/text.ts";
import { Gone } from "./generic-item.tsx";

export type Kind = "guest" | "vendor";

export function Person({ id, kind, wide }: { id: string; kind: Kind; wide: boolean }) {
  const rows = useTable("items");
  const { label } = usePartner();
  const { row, gone } = useOpenRow(rows.find((candidate) => candidate.id === id && candidate.kind === kind));
  const back = `#/${views[kind].route}`;
  if (!row) return <Gone name={kind} id={id} back={back} wide={wide} />;
  const guest = kind === "guest";
  const phone = typeof row.data?.phone === "string" ? row.data.phone : null;
  const pic = typeof row.data?.pic === "string" ? row.data.pic : null;
  const Heading = wide ? "h3" : "h2";

  return (
    <>
      <DetailTitle wide={wide}>{row.title}</DetailTitle>
      <p className="kicker">
        {text.contacts[kind]} · {row.group_key ?? text.contacts.noGroup}
      </p>
      <p className="facts">
        <span className="mark" data-status={row.status ?? undefined}>
          {optionLabel(kind, "status", row.status ?? "", label)}
        </span>
        {guest ? (
          <>
            <span>{text.people(row.qty ?? 1)}</span>
            <Who side={row.who} />
          </>
        ) : (
          <>
            {pic && <span>{pic}</span>}
            {row.amount !== null && <Money rupiah={row.amount} />}
          </>
        )}
      </p>
      {phone ? <Contact phone={phone} title={row.title} call labelled /> : <p className="hint">{text.contacts.noPhone}</p>}
      <section aria-labelledby="person-edit">
        <Heading id="person-edit">{text.contacts.edit}</Heading>
        <ItemForm key={row.id} name={kind} row={row} gone={gone} />
      </section>
      {!wide && (
        <p className="trail">
          <a href={back}>{text.back}</a>
        </p>
      )}
    </>
  );
}
