import { useState } from "react";
import type { ItemRow, Patch } from "../../shared/tables.ts";
import { WATCH, originalOf, ratingOf, ratingPatch, statusPatch, watchOf, yearOf } from "../domain/screen.ts";
import type { ScreenKind } from "../domain/screen.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { usePartner, useStamp } from "../hooks/use-plan.ts";
import { actions, useTable } from "../hooks/use-store.ts";
import { Avatar, Who } from "../ui/avatar.tsx";
import { Cover, Stars } from "../ui/book-bits.tsx";
import { failureOf } from "../ui/failure.ts";
import { formatDate } from "../ui/format.ts";
import { Icon } from "../ui/icons.tsx";
import { ItemForm } from "../ui/item-form.tsx";
import { views } from "../ui/registry.ts";
import { removeScreen } from "../ui/screen-save.ts";
import { text } from "../ui/text.ts";
import { Title } from "../ui/title.tsx";
import { Gone } from "./generic-item.tsx";

function Status({ row }: { row: ItemRow }) {
  const stamp = useStamp();
  const { busy, once } = useBusy();
  const [failure, setFailure] = useState<string[]>([]);
  const now = watchOf(row);
  return (
    <section aria-labelledby="sc-status">
      <h2 id="sc-status">{text.screen.status}</h2>
      <div role="group" aria-label={text.screen.status} className="seg">
        {WATCH.map((pick) => (
          <button
            key={pick}
            type="button"
            disabled={busy}
            aria-pressed={now === pick}
            onClick={() => {
              const patch = statusPatch(row, pick, stamp());
              if (patch !== null) return once(async () => setFailure(failureOf(await actions.update("items", row.id, patch))));
            }}
          >
            {text.screen.pick[pick]}
          </button>
        ))}
      </div>
      {now === "watched" && row.done_on !== null && <p className="hint">{text.screen.watchedOn(formatDate(row.done_on))}</p>}
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
    </section>
  );
}

function Ratings({ row }: { row: ItemRow }) {
  const { me, label } = usePartner();
  const { busy, once } = useBusy();
  const [failure, setFailure] = useState<string[]>([]);
  const sides = me === "b" ? (["b", "a"] as const) : (["a", "b"] as const);
  const run = (patch: Patch<"items">) => once(async () => setFailure(failureOf(await actions.update("items", row.id, patch))));
  return (
    <section aria-labelledby="sc-ratings">
      <h2 id="sc-ratings">{text.screen.ratings}</h2>
      {sides.map((side) => {
        const stars = ratingOf(row, side);
        return (
          <div key={side} className="reader">
            <p className="reader-n">
              <Avatar side={side} />
              {label(side)}
            </p>
            {side === me ? (
              <div className="rate" role="group" aria-label={`${label(side)}: ${text.screen.rate}`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" className="star" disabled={busy} aria-pressed={stars === n} aria-label={text.screen.rateStar(n)} data-on={(stars ?? 0) >= n || undefined} onClick={() => run(ratingPatch(row, side, n))}>
                    <Icon name="star" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="reader-s">{stars === null ? text.screen.notRated : <Stars value={stars} />}</p>
            )}
          </div>
        );
      })}
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
    </section>
  );
}

export function ScreenDetail({ kind, id }: { kind: ScreenKind; id: string }) {
  const rows = useTable("items");
  const row = rows.find((candidate) => candidate.id === id && candidate.kind === kind);
  const words = kind === "movie" ? text.movies : text.series;
  const back = `#/${views[kind].route}`;
  if (!row) return <Gone name={kind} id={id} back={back} />;
  const original = originalOf(row);
  const year = yearOf(row);
  return (
    <>
      <p className="trail">
        <a href={back}>
          <Icon name="back" />
          {words.title}
        </a>
      </p>
      <div className="bk-head">
        <Cover book={row} />
        <div className="bk-id">
          <Title>{row.title}</Title>
          {original && <p className="bk-sub">{text.screen.original(original)}</p>}
          {(year !== null || (row.who !== null && row.who !== "both")) && (
            <p className="hint facts">
              {year !== null && <span>{year}</span>}
              {row.who !== null && row.who !== "both" && <Who side={row.who} />}
            </p>
          )}
        </div>
      </div>
      <Status row={row} />
      {watchOf(row) === "watched" && <Ratings row={row} />}
      {row.note && (
        <section aria-labelledby="sc-notes">
          <h2 id="sc-notes">{text.screen.notes}</h2>
          <p className="bk-text-block">{row.note}</p>
        </section>
      )}
      <section aria-labelledby="sc-edit">
        <h2 id="sc-edit">{text.screen.edit}</h2>
        <ItemForm
          key={row.id}
          name={kind}
          row={row}
          onRemove={() =>
            removeScreen(
              {
                actions,
                go: (hash) => {
                  location.hash = hash;
                },
              },
              row,
              kind,
            )
          }
        />
      </section>
    </>
  );
}
