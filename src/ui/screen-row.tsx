import type { ItemRow } from "../../shared/tables.ts";
import { screenFacts, watchOf } from "../domain/screen.ts";
import type { ScreenKind } from "../domain/screen.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { Who } from "./avatar.tsx";
import { Cover, Stars } from "./book-bits.tsx";
import { formatDate } from "./format.ts";
import { Icon } from "./icons.tsx";
import { views } from "./registry.ts";
import { text } from "./text.ts";

export type Member = { position: number; next: boolean; first: boolean; last: boolean; onMove: (step: -1 | 1) => void };

export function ScreenRow({ row, kind, member }: { row: ItemRow; kind: ScreenKind; member?: Member }) {
  const { me, label } = usePartner();
  const { sub, side, watchedOn, rated } = screenFacts(row, me);
  const words = text.screen.collection;
  return (
    <li className="bk" data-member={member ? true : undefined} data-next={member?.next || undefined}>
      {member && <span className="co-no">{member.position}</span>}
      <a className="bk-link" href={`#/${views[kind].route}/${row.id}`}>
        <Cover book={row} />
        <span className="bk-text">
          <span className="title">{row.title}</span>
          {sub !== "" && <span className="bk-by">{sub}</span>}
          <span className="meta">
            {member && <span className="co-state">{text.screen.pick[watchOf(row)]}</span>}
            {member?.next && <span className="co-next">{words.nextUp}</span>}
            {side !== null && <Who side={side} />}
            {watchedOn !== null && <span>{text.screen.watchedOn(formatDate(watchedOn))}</span>}
            {rated.map(({ side: rater, stars }) => (
              <span key={rater} className="reads">
                {label(rater)}
                <Stars value={stars} />
              </span>
            ))}
          </span>
        </span>
      </a>
      {member && (
        <span className="acts">
          <button type="button" className="ib" data-move={`up:${row.id}`} disabled={member.first} aria-label={words.up(row.title)} onClick={() => member.onMove(-1)}>
            <Icon name="up" />
          </button>
          <button type="button" className="ib" data-move={`down:${row.id}`} disabled={member.last} aria-label={words.down(row.title)} onClick={() => member.onMove(1)}>
            <Icon name="down" />
          </button>
        </span>
      )}
    </li>
  );
}
