import type { ItemRow } from "../../shared/tables.ts";
import { screenFacts } from "../domain/screen.ts";
import type { ScreenKind } from "../domain/screen.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { Who } from "./avatar.tsx";
import { Cover, Stars } from "./book-bits.tsx";
import { formatDate } from "./format.ts";
import { views } from "./registry.ts";
import { text } from "./text.ts";

export function ScreenRow({ row, kind }: { row: ItemRow; kind: ScreenKind }) {
  const { me, label } = usePartner();
  const { sub, side, watchedOn, rated } = screenFacts(row, me);
  return (
    <li className="bk">
      <a className="bk-link" href={`#/${views[kind].route}/${row.id}`}>
        <Cover book={row} />
        <span className="bk-text">
          <span className="title">{row.title}</span>
          {sub !== "" && <span className="bk-by">{sub}</span>}
          <span className="meta">
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
    </li>
  );
}
