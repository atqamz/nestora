import { useMemo, useState } from "react";
import type { ItemRow } from "../../shared/tables.ts";
import { screenList } from "../domain/screen.ts";
import type { ScreenKind } from "../domain/screen.ts";
import { usesTmdb } from "../domain/tmdb.ts";
import { useTable } from "../hooks/use-store.ts";
import { CollectionSection } from "../ui/collection-section.tsx";
import { Icon } from "../ui/icons.tsx";
import { ListHead } from "../ui/list-head.tsx";
import { ScreenPosters } from "../ui/screen-posters.tsx";
import { ScreenRow } from "../ui/screen-row.tsx";
import { ScreenSheet } from "../ui/screen-sheet.tsx";
import { LibraryTabs } from "../ui/space-tabs.tsx";
import { text } from "../ui/text.ts";
import { TmdbCredit } from "../ui/tmdb-credit.tsx";
import { ScreenDetail } from "./screen.tsx";

function ScreenList({ kind }: { kind: ScreenKind }) {
  const items = useTable("items");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const words = kind === "movie" ? text.movies : text.series;
  const shown = useMemo(() => screenList(items, kind, query), [items, kind, query]);
  const own = useMemo(() => items.filter((row) => row.kind === kind), [items, kind]);
  const list = (rows: readonly ItemRow[]) => (
    <ul className="rows">
      {rows.map((row) => (
        <ScreenRow key={row.id} row={row} kind={kind} />
      ))}
    </ul>
  );

  return (
    <>
      <LibraryTabs screen={kind === "movie" ? "movies" : "series"} />
      <ListHead title={words.title} add={words.add} onAdd={() => setAdding(true)} />
      {shown.mode !== "empty" && (
        <form role="search" className="capture lib-find" onSubmit={(event) => event.preventDefault()}>
          <label className="visually-hidden" htmlFor={`find-${kind}`}>
            {words.search}
          </label>
          <Icon name="search" />
          <input
            id={`find-${kind}`}
            type="search"
            value={query}
            maxLength={500}
            autoComplete="off"
            enterKeyHint="search"
            placeholder={text.screen.placeholder}
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>
      )}
      {shown.mode === "found" ? (
        shown.found.length === 0 ? (
          <p className="empty">{text.screen.noMatch}</p>
        ) : (
          <section aria-label={words.search}>
            <p className="hint" role="status">
              {words.found(shown.found.length)}
            </p>
            {list(shown.found)}
          </section>
        )
      ) : shown.mode === "empty" ? (
        <p className="empty">{words.empty}</p>
      ) : (
        <>
          {shown.watching.length > 0 && (
            <section aria-labelledby="sc-watching">
              <h2 id="sc-watching">{text.screen.watching}</h2>
              {list(shown.watching)}
            </section>
          )}
          {shown.groups.map((group) => (
            <CollectionSection key={group.key} kind={kind} group={group} />
          ))}
          {shown.want.length > 0 ? (
            <section aria-labelledby="sc-want">
              <h2 id="sc-want">
                {text.screen.want} <span className="tally">{shown.want.length}</span>
              </h2>
              {list(shown.want)}
            </section>
          ) : (
            shown.allWatched && <p className="empty">{words.allWatched}</p>
          )}
          {shown.watched.length > 0 && (
            <details className="shelf-sec" open={shown.openWatched}>
              <summary>
                <span className="shelf-name">{text.screen.watched}</span>
                <span className="tally">{shown.watched.length}</span>
              </summary>
              {list(shown.watched)}
            </details>
          )}
        </>
      )}
      <ScreenPosters kind={kind} rows={own} />
      {usesTmdb(items, kind) && <TmdbCredit />}
      {adding && <ScreenSheet kind={kind} onClose={() => setAdding(false)} />}
    </>
  );
}

export function Screens({ kind, id }: { kind: ScreenKind; id?: string }) {
  return id === undefined ? <ScreenList key={kind} kind={kind} /> : <ScreenDetail key={id} kind={kind} id={id} />;
}
