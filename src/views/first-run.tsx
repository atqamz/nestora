import { useRef } from "react";
import { useSettings } from "../hooks/use-plan.ts";
import { useSnapshot } from "../hooks/use-store.ts";
import { Icon } from "../ui/icons.tsx";
import { text } from "../ui/text.ts";

const copy = text.home.firstRun;

function Step({ href, title, note }: { href: string; title: string; note: string }) {
  return (
    <li>
      <div className="row rt-row">
        <a className="rt-link" href={href}>
          <span className="rt-text">
            <span className="title">{title}</span>
            <span className="meta">{note}</span>
          </span>
          <Icon name="forward" />
        </a>
      </div>
    </li>
  );
}

export function FirstRun() {
  const { ceremonyDate, partnerA, partnerB } = useSettings();
  const { dated } = useSnapshot();
  const first = useRef<{ names: boolean; date: boolean } | null>(null);
  if (dated) first.current ??= { names: !(partnerA?.trim() && partnerB?.trim()), date: ceremonyDate === null };
  const { names, date } = first.current ?? { names: false, date: false };
  if (!names && !date) return null;
  return (
    <section className="group first-run" aria-labelledby="first-run">
      <h2 id="first-run">{copy.title}</h2>
      <ul className="rows">
        {names && <Step href="#/settings/names" title={copy.names} note={copy.namesNote} />}
        {date && <Step href="#/settings/akad" title={copy.date} note={copy.dateNote} />}
      </ul>
    </section>
  );
}
