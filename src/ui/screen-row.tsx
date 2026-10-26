import type { ItemRow } from "../../shared/tables.ts";
import { originalOf, ratingOf, watchOf, yearOf } from "../domain/screen.ts";
import type { ScreenKind } from "../domain/screen.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { Who } from "./avatar.tsx";
import { Cover, Stars } from "./book-bits.tsx";
import { formatDate } from "./format.ts";
import { views } from "./registry.ts";
import { text } from "./text.ts";

export function ScreenRow({ row, kind }: { row: ItemRow; kind: ScreenKind }) {
  const { me, label } = usePartner();
  const sides = me === "b" ? (["b", "a"] as const) : (["a", "b"] as const);
  const watched = watchOf(row) === "watched";
  const year = yearOf(row);
  const sub = [originalOf(row), year === null ? null : String(year)].filter(Boolean).join(" · ");
  return (
    <li className="bk">
      <a className="bk-link" href={`#/${views[kind].route}/${row.id}`}>
        <Cover book={row} />
        <span className="bk-text">
          <span className="title">{row.title}</span>
          {sub !== "" && <span className="bk-by">{sub}</span>}
          <span className="meta">
            {(row.who === "a" || row.who === "b") && <Who side={row.who} />}
            {watched && row.done_on !== null && <span>{text.screen.watchedOn(formatDate(row.done_on))}</span>}
            {watched &&
              sides.flatMap((side) => {
                const stars = ratingOf(row, side);
                return stars === null ? [] : [
                  <span key={side} className="reads">
                    {label(side)}
                    <Stars value={stars} />
                  </span>,
                ];
              })}
          </span>
        </span>
      </a>
    </li>
  );
}
