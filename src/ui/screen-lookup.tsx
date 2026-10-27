import type { MouseEvent } from "react";
import type { ScreenKind } from "../domain/screen.ts";
import { hitSub } from "../domain/tmdb.ts";
import type { ScreenHit } from "../domain/tmdb.ts";
import type { Search } from "../store/lookup.ts";
import { Cover } from "./book-bits.tsx";
import { text } from "./text.ts";
import { TmdbCredit } from "./tmdb-credit.tsx";

const WORDS = text.screen.lookup;

const notice = (search: Search<ScreenHit>, noun: string) =>
  search.state === "busy"
    ? WORDS.searching(noun)
    : search.state === "offline"
      ? WORDS.offline
      : search.state === "failed"
        ? WORDS.failed(noun)
        : search.state === "slow"
          ? WORDS.slow(noun)
          : search.state === "empty"
            ? WORDS.empty
            : search.state === "found"
              ? WORDS.found(search.hits.length)
              : "";

export const choose = (event: Pick<MouseEvent<HTMLButtonElement>, "currentTarget">, hit: ScreenHit, onPick: (hit: ScreenHit) => void) => {
  const title = event.currentTarget.closest("dialog")?.querySelector<HTMLInputElement>('input[name="title"]');
  onPick(hit);
  title?.focus();
};

export function ScreenLookup({ kind, search, have, onPick }: { kind: ScreenKind; search: Search<ScreenHit>; have: ReadonlySet<number>; onPick: (hit: ScreenHit) => void }) {
  return (
    <div className="lookup">
      <p className="hint look-note" role="status">
        {notice(search, kind === "movie" ? text.movies.noun : text.series.noun)}
      </p>
      {search.hits.length > 0 && (
        <>
          <ul className="hits" aria-label={WORDS.results}>
            {search.hits.map((hit) => {
              const sub = hitSub(hit);
              return (
                <li key={hit.tmdb}>
                  <button type="button" className="hit" onClick={(event) => choose(event, hit, onPick)}>
                    <Cover book={{ title: hit.title, data: { cover: hit.cover } }} />
                    <span className="bk-text">
                      <span className="title">{hit.title}</span>
                      {sub !== "" && <span className="bk-by">{sub}</span>}
                      {have.has(hit.tmdb) && <span className="bk-by">{WORDS.have}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <TmdbCredit />
        </>
      )}
    </div>
  );
}
