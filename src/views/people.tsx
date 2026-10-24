import { useMemo, useState } from "react";
import type { ItemRow } from "../../shared/tables.ts";
import { sectionsOf } from "../domain/groups.ts";
import { headcount, total } from "../domain/guests.ts";
import { bySort } from "../domain/order.ts";
import { owns } from "../domain/owner.ts";
import type { Owner } from "../domain/owner.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { useTable } from "../hooks/use-store.ts";
import { Avatar, Who } from "../ui/avatar.tsx";
import { Contact } from "../ui/contact.tsx";
import { optionLabel } from "../ui/labels.ts";
import { MarriageTabs } from "../ui/marriage-tabs.tsx";
import { Money } from "../ui/money.tsx";
import { OwnerFilter } from "../ui/owner-filter.tsx";
import { QuickAdd } from "../ui/quick-add.tsx";
import { statusRank, views } from "../ui/registry.ts";
import { Split } from "../ui/split.tsx";
import { text } from "../ui/text.ts";
import { Title } from "../ui/title.tsx";
import { Person } from "./person.tsx";
import type { Kind } from "./person.tsx";

const phoneOf = (row: ItemRow) => (typeof row.data?.phone === "string" ? row.data.phone : null);

function PersonRow({ row, kind, selected }: { row: ItemRow; kind: Kind; selected: boolean }) {
  const { label } = usePartner();
  const phone = phoneOf(row);
  const guest = kind === "guest";
  const pic = typeof row.data?.pic === "string" ? row.data.pic : null;
  return (
    <li data-selected={selected || undefined}>
      <div className="row person">
        <a className="row-b" href={`#/${views[kind].route}/${row.id}`} aria-current={selected ? "true" : undefined}>
          <span className="title">{row.title}</span>
          <span className="meta">
            <span className="mark" data-status={row.status ?? undefined}>
              {optionLabel(kind, "status", row.status ?? "", label)}
            </span>
            {guest ? (
              <>
                <span>{text.people(row.qty ?? 1)}</span>
                <Who side={row.who} />
              </>
            ) : (
              pic && <span>{pic}</span>
            )}
          </span>
        </a>
        {!guest && (
          <span className="quote">
            {row.amount === null ? (
              text.contacts.noQuote
            ) : (
              <>
                <span className="visually-hidden">{text.contacts.quote} </span>
                <Money rupiah={row.amount} />
              </>
            )}
          </span>
        )}
        {phone ? <Contact phone={phone} title={row.title} call={!guest} /> : guest && <span className="nophone">{text.noNumber}</span>}
      </div>
    </li>
  );
}

function GuestSummary({ guests }: { guests: readonly ItemRow[] }) {
  const { label } = usePartner();
  const count = headcount(guests);
  const all = total(count);
  return (
    <div className="summary">
      <p className="sum">
        <b>{text.contacts.invitations(guests.length)}</b> · <b>{text.people(all.people)}</b>
      </p>
      <ul className="sides">
        {(["a", "b"] as const).map((side) => (
          <li key={side}>
            <Avatar side={side} />
            {label(side)} <b>{text.people(count[side].people)}</b>
          </li>
        ))}
        {count.none.guests > 0 && (
          <li>
            <Avatar side={null} />
            {text.nobody} <b>{text.people(count.none.people)}</b>
          </li>
        )}
      </ul>
    </div>
  );
}

const sorted = (rows: readonly ItemRow[], kind: Kind) =>
  [...rows].sort((a, b) => statusRank(kind, a.status) - statusRank(kind, b.status) || bySort(a, b));

export function People({ route, id }: { route: string; id?: string }) {
  const items = useTable("items");
  const { me } = usePartner();
  const [owner, setOwner] = useState<Owner>("everyone");
  const guests = useMemo(() => items.filter((item) => item.kind === "guest"), [items]);
  const vendors = useMemo(() => items.filter((item) => item.kind === "vendor"), [items]);
  const picked = id === undefined ? undefined : [...guests, ...vendors].find((row) => row.id === id);
  const kind: Kind = picked ? (picked.kind as Kind) : route === "vendors" ? "vendor" : "guest";
  const own = kind === "guest" ? guests : vendors;
  const visible = useMemo(() => sorted(own.filter((row) => kind !== "guest" || owns(row.who, owner, me)), kind), [own, kind, owner, me]);
  const sections = useMemo(() => sectionsOf(visible), [visible]);

  const list = (
    <>
      <Title>{text.nav.people}</Title>
      <MarriageTabs screen="people" />
      <div role="group" aria-label={text.contacts.switch} className="seg">
        <a href="#/guests" aria-current={kind === "guest" ? "page" : undefined}>
          {text.contacts.guests} <b>{guests.length}</b>
        </a>
        <a href="#/vendors" aria-current={kind === "vendor" ? "page" : undefined}>
          {text.contacts.vendors} <b>{vendors.length}</b>
        </a>
      </div>
      {own.length > 0 &&
        (kind === "guest" ? (
          <GuestSummary guests={guests} />
        ) : (
          <div className="summary">
            <p className="sum">
              <b>{text.contacts.vendorCount(vendors.length)}</b> · {text.contacts.booked(vendors.filter((row) => row.status === "confirmed").length)}
            </p>
          </div>
        ))}
      <QuickAdd name={kind} />
      {kind === "guest" && guests.length > 0 && <OwnerFilter value={owner} onChange={setOwner} owners={guests.map((row) => row.who)} />}
      {own.length === 0 ? (
        <p className="empty">{text.empty[kind]}</p>
      ) : visible.length === 0 ? (
        <p className="empty">{text.owner.empty}</p>
      ) : (
        sections.map((section, index) => (
          <section key={section.key ?? ""} className="people-group" aria-labelledby={`people-${index}`}>
            <h2 id={`people-${index}`}>
              {section.key ?? text.contacts.noGroup}{" "}
              <span className="tally">{kind === "guest" ? text.people(total(headcount(section.rows)).people) : section.rows.length}</span>
            </h2>
            <div className="roster" data-kind={kind}>
              <ul className="rows">
                {section.rows.map((row) => (
                  <PersonRow key={row.id} row={row} kind={kind} selected={row.id === id} />
                ))}
              </ul>
            </div>
          </section>
        ))
      )}
    </>
  );

  return <Split open={id !== undefined} hint={text.contacts.pick} list={list} detail={(wide) => <Person key={id} id={id!} kind={kind} wide={wide} />} />;
}
