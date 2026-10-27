import { useSettings } from "../hooks/use-plan.ts";
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
  const named = Boolean(partnerA?.trim() && partnerB?.trim());
  if (named && ceremonyDate !== null) return null;
  return (
    <section className="group first-run" aria-labelledby="first-run">
      <h2 id="first-run">{copy.title}</h2>
      <ul className="rows">
        {!named && <Step href="#/settings/names" title={copy.names} note={copy.namesNote} />}
        {ceremonyDate === null && <Step href="#/settings/akad" title={copy.date} note={copy.dateNote} />}
      </ul>
    </section>
  );
}
