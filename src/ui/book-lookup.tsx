import { useRef, useState } from "react";
import type { ItemRow } from "../../shared/tables.ts";
import { coverUrl, workPage } from "../domain/openlibrary.ts";
import { lookup } from "../hooks/use-lookup.ts";
import { actions } from "../hooks/use-store.ts";
import { useCanScan } from "../hooks/use-scan.ts";
import { fillBook } from "../store/lookup.ts";
import type { Fill } from "../store/lookup.ts";
import { Cover } from "./book-bits.tsx";
import type { BookForm } from "./book-sheet.tsx";
import { failureOf } from "./failure.ts";
import { ScanIsbn } from "./scan.tsx";
import { text } from "./text.ts";

const WORDS = text.books.lookup;

const notice = (state: string) =>
  state === "busy" ? WORDS.searching : state === "offline" ? WORDS.offline : state === "failed" ? WORDS.failed : state === "slow" ? WORDS.slow : state === "empty" ? WORDS.empty : state === "mismatch" ? WORDS.mismatch : "";

export function Credit({ work }: { work?: string | null }) {
  const page = work ? workPage(work) : null;
  return (
    <p className="hint credit">
      {page === null ? (
        WORDS.credit
      ) : (
        <a href={page} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
          {WORDS.credit}
        </a>
      )}
    </p>
  );
}

export function BookLookup({ form }: { form: BookForm }) {
  const { search, accept } = form.fields;
  return (
    <div className="lookup">
      <p className="hint look-note" role="status">
        {notice(search.state)}
      </p>
      {search.hits.length > 0 && (
        <>
          <ul className="hits" aria-label={WORDS.results}>
            {search.hits.map((hit) => (
              <li key={hit.work}>
                <button type="button" className="hit" onClick={() => accept(hit)}>
                  <Cover book={{ id: hit.work, title: hit.title, data: { cover: hit.coverId === null ? null : coverUrl(hit.coverId) } }} />
                  <span className="bk-text">
                    <span className="title">{hit.title}</span>
                    {(hit.author !== "" || hit.year !== null) && <span className="bk-by">{[hit.author, hit.year].filter(Boolean).join(" · ")}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Credit />
        </>
      )}
    </div>
  );
}

export function FillDetails({ form }: { form: BookForm }) {
  const { checked, fill, fillIn } = form.fields;
  if (!checked.ok || checked.value === null) return null;
  const note = fill === "busy" ? WORDS.filling : fill === "done" ? WORDS.filled : notice(fill);
  return (
    <div className="fill">
      <button type="button" className="secondary" disabled={fill === "busy"} onClick={() => void fillIn()}>
        {WORDS.fill}
      </button>
      <p className="hint look-note" role="status">
        {note}
      </p>
    </div>
  );
}

export function FillBook({ book }: { book: ItemRow }) {
  const [state, setState] = useState<Fill | "nothing">("idle");
  const [failure, setFailure] = useState<string[]>([]);
  const [kept, setKept] = useState(false);
  const can = useCanScan();
  const latest = useRef(book);
  latest.current = book;
  const isbn = typeof book.data?.isbn === "string" ? book.data.isbn : null;
  const work = typeof book.data?.ol === "string" ? book.data.ol : null;
  if (isbn === null && work === null && !can) return null;

  const run = async (code: string) => {
    setState("busy");
    setFailure([]);
    const out = await fillBook(lookup, code, () => latest.current);
    if (out.kind === "stale") return setState("idle");
    if (out.kind !== "patch") return setState(out.kind === "nothing" ? "nothing" : out.kind);
    const result = await actions.update("items", book.id, { data: out.patch });
    setFailure(failureOf(result));
    setState(result.ok ? "done" : "idle");
  };

  const onScan = async (code: string) => {
    setKept(true);
    const result = await actions.update("items", book.id, { data: { isbn: code } });
    setFailure(failureOf(result));
    if (result.ok) await run(code);
  };

  const note = state === "busy" ? WORDS.filling : state === "done" ? WORDS.filled : state === "nothing" ? WORDS.nothingNew : notice(state);
  return (
    <div className="fill">
      {isbn !== null && (
        <>
          <button type="button" className="secondary" disabled={state === "busy"} onClick={() => void run(isbn)}>
            {WORDS.fill}
          </button>
          <p className="hint look-note" role="status">
            {note}
          </p>
        </>
      )}
      {(isbn === null || kept) && <ScanIsbn onIsbn={(code) => void onScan(code)} />}
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
      {work !== null && <Credit work={work} />}
    </div>
  );
}
