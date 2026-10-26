import { useMemo, useState } from "react";
import { screenSections, searchScreens } from "../domain/screen.ts";
import type { ScreenKind } from "../domain/screen.ts";
import { useTable } from "../hooks/use-store.ts";
import { Icon } from "../ui/icons.tsx";
import { ScreenRow } from "../ui/screen-row.tsx";
import { ScreenSheet } from "../ui/screen-sheet.tsx";
import { LibraryTabs } from "../ui/space-tabs.tsx";
import { text } from "../ui/text.ts";
import { Title } from "../ui/title.tsx";
import { ScreenDetail } from "./screen.tsx";

const OPEN_ALL = 30;

function ScreenList({ kind }: { kind: ScreenKind }) {
  const items = useTable("items");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const words = kind === "movie" ? text.movies : text.series;
  const { watching, want, watched } = useMemo(() => screenSections(items, kind), [items, kind]);
  const total = watching.length + want.length + watched.length;
  const found = useMemo(() => (query.trim() === "" || total === 0 ? null : searchScreens(query, items, kind)), [query, items, kind, total]);
  const list = (rows: typeof want) => (
    <ul className="rows">
      {rows.map((row) => (
        <ScreenRow key={row.id} row={row} kind={kind} />
      ))}
    </ul>
  );

  return (
    <>
      <LibraryTabs screen={kind === "movie" ? "movies" : "series"} />
      <Title>{words.title}</Title>
      <div className="bk-tools">
        <button type="button" onClick={() => setAdding(true)}>
          <Icon name="plus" />
          {words.add}
        </button>
      </div>
      {total > 0 && (
        <form role="search" className="capture" onSubmit={(event) => event.preventDefault()}>
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
      {found !== null ? (
        found.length === 0 ? (
          <p className="empty">{text.screen.noMatch}</p>
        ) : (
          <section aria-label={words.search}>
            <p className="hint" role="status">
              {words.found(found.length)}
            </p>
            {list(found)}
          </section>
        )
      ) : total === 0 ? (
        <p className="empty">{words.empty}</p>
      ) : (
        <>
          {watching.length > 0 && (
            <section aria-labelledby="sc-watching">
              <h2 id="sc-watching">{text.screen.watching}</h2>
              {list(watching)}
            </section>
          )}
          {want.length > 0 ? (
            <section aria-labelledby="sc-want">
              <h2 id="sc-want">
                {text.screen.want} <span className="tally">{want.length}</span>
              </h2>
              {list(want)}
            </section>
          ) : (
            watching.length === 0 && <p className="empty">{words.allWatched}</p>
          )}
          {watched.length > 0 && (
            <details className="shelf-sec" open={watched.length <= OPEN_ALL}>
              <summary>
                <span className="shelf-name">{text.screen.watched}</span>
                <span className="tally">{watched.length}</span>
              </summary>
              {list(watched)}
            </details>
          )}
        </>
      )}
      {adding && <ScreenSheet kind={kind} onClose={() => setAdding(false)} />}
    </>
  );
}

export function Screens({ kind, id }: { kind: ScreenKind; id?: string }) {
  return id === undefined ? <ScreenList kind={kind} /> : <ScreenDetail key={id} kind={kind} id={id} />;
}
