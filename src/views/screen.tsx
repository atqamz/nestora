import { useState } from "react";
import type { ItemRow, Patch } from "../../shared/tables.ts";
import { WATCH, ratingPatch, ratingRows, screenDetail, screenFacts, watchOf } from "../domain/screen.ts";
import type { ScreenKind } from "../domain/screen.ts";
import { tmdbPage, usesTmdb, validId } from "../domain/tmdb.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { useOpenRow } from "../hooks/use-open-row.ts";
import { usePartner, useStamp } from "../hooks/use-plan.ts";
import { actions, useTable } from "../hooks/use-store.ts";
import { Avatar, Who } from "../ui/avatar.tsx";
import { Cover, Stars } from "../ui/book-bits.tsx";
import { failureOf } from "../ui/failure.ts";
import { formatDate } from "../ui/format.ts";
import { Icon } from "../ui/icons.tsx";
import { ItemForm } from "../ui/item-form.tsx";
import { views } from "../ui/registry.ts";
import { moveScreen, removeScreen } from "../ui/screen-save.ts";
import { text } from "../ui/text.ts";
import { DetailTitle } from "../ui/split.tsx";
import { TmdbCredit } from "../ui/tmdb-credit.tsx";
import { Title } from "../ui/title.tsx";
import { Gone } from "./generic-item.tsx";

function Status({ row, watchedOn }: { row: ItemRow; watchedOn: string | null }) {
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
            onClick={() => once(async () => setFailure(failureOf(await moveScreen(actions, row, pick, stamp()))))}
          >
            {text.screen.pick[pick]}
          </button>
        ))}
      </div>
      {watchedOn !== null && <p className="hint">{text.screen.watchedOn(formatDate(watchedOn))}</p>}
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
  const run = (patch: Patch<"items">) => once(async () => setFailure(failureOf(await actions.update("items", row.id, patch))));
  return (
    <section aria-labelledby="sc-ratings">
      <h2 id="sc-ratings">{text.screen.ratings}</h2>
      {ratingRows(row, me).map(({ side, stars, mine }) => (
        <div key={side} className="reader">
          <p className="reader-n">
            <Avatar side={side} />
            {label(side)}
          </p>
          {mine ? (
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
      ))}
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
  const { me } = usePartner();
  const { row: live, elsewhere } = screenDetail(rows, kind, id);
  const { row, gone } = useOpenRow(live ?? undefined);
  const words = kind === "movie" ? text.movies : text.series;
  const back = `#/${views[kind].route}`;
  if (!row && elsewhere) {
    return (
      <>
        <DetailTitle wide={false}>{text.screen.notHere}</DetailTitle>
        <div className="form-actions">
          <a className="button secondary" href={back}>
            {text.back}
          </a>
        </div>
      </>
    );
  }
  if (!row) return <Gone name={kind} id={id} back={back} />;
  const { original, year, side, watched, watchedOn } = screenFacts(row, me);
  const tmdb = validId(row.data?.tmdb);
  return (
    <>
      <p className="trail">
        <a href={back}>
          <Icon name="back" />
          {words.title}
        </a>
      </p>
      <div className="bk-head">
        <Cover book={row} alt={text.screen.posterOf(row.title)} />
        <div className="bk-id">
          <Title>{row.title}</Title>
          {original && <p className="bk-sub">{text.screen.original(original)}</p>}
          {(year !== null || side !== null) && (
            <p className="hint facts">
              {year !== null && <span>{year}</span>}
              {side !== null && <Who side={side} />}
            </p>
          )}
        </div>
      </div>
      {!gone && <Status row={row} watchedOn={watchedOn} />}
      {!gone && watched && <Ratings row={row} />}
      {row.note && (
        <section aria-labelledby="sc-notes">
          <h2 id="sc-notes">{text.screen.notes}</h2>
          <p className="bk-text-block">{row.note}</p>
        </section>
      )}
      {tmdb !== null && (
        <p>
          <a className="button secondary" href={tmdbPage(kind, tmdb)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
            {text.screen.tmdb}
          </a>
        </p>
      )}
      <section aria-labelledby="sc-edit">
        <h2 id="sc-edit">{text.screen.edit}</h2>
        <ItemForm
          key={row.id}
          name={kind}
          row={row}
          gone={gone}
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
      {usesTmdb([row], kind) && <TmdbCredit />}
    </>
  );
}
