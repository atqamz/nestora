import { useEffect, useRef, useState } from "react";
import type { ItemRow } from "../../shared/tables.ts";
import { POWERED_BY } from "../domain/googlebooks.ts";
import { pageOf } from "../domain/openlibrary.ts";
import type { Source } from "../domain/openlibrary.ts";
import { lookup } from "../hooks/use-lookup.ts";
import { actions } from "../hooks/use-store.ts";
import { useCanScan } from "../hooks/use-scan.ts";
import { useWriteLock } from "../hooks/use-write-lock.ts";
import { decide, dismisses, fillBook, landing, scanBook, turns } from "../store/lookup.ts";
import type { Choice, Fill, Pending } from "../store/lookup.ts";
import { Cover } from "./book-bits.tsx";
import type { BookForm } from "./book-sheet.tsx";
import { failureOf } from "./failure.ts";
import { ScanIsbn } from "./scan.tsx";
import { text } from "./text.ts";

const WORDS = text.books.lookup;

const notice = (state: string) =>
  state === "busy" ? WORDS.searching : state === "offline" ? WORDS.offline : state === "failed" ? WORDS.failed : state === "slow" ? WORDS.slow : state === "empty" ? WORDS.empty : state === "mismatch" ? WORDS.mismatch : state === "changed" ? WORDS.changed : "";

export function Credit({ source, work }: { source: Source; work?: string | null }) {
  const page = work ? pageOf(source, work) : null;
  const line = WORDS.credit[source];
  return (
    <p className="hint credit">
      {page === null ? (
        line
      ) : (
        <a href={page} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
          {line}
        </a>
      )}
      {source === "google" && <img className="powered" src={POWERED_BY} alt={WORDS.powered} width="62" height="30" decoding="async" referrerPolicy="no-referrer" />}
    </p>
  );
}

export function BookLookup({ form }: { form: BookForm }) {
  const { search, accept } = form.fields;
  const [first] = search.hits;
  return (
    <div className="lookup">
      <p className="hint look-note" role="status">
        {notice(search.state)}
      </p>
      {first !== undefined && (
        <>
          <ul className="hits" aria-label={WORDS.results[first.source]}>
            {search.hits.map((hit) => (
              <li key={hit.work}>
                <button type="button" className="hit" onClick={() => accept(hit)}>
                  <Cover book={{ title: hit.title, data: { cover: hit.cover } }} />
                  <span className="bk-text">
                    <span className="title">{hit.title}</span>
                    {(hit.author !== "" || hit.year !== null) && <span className="bk-by">{[hit.author, hit.year].filter(Boolean).join(" · ")}</span>}
                  </span>
                </button>
                {hit.source === "google" && (
                  <a className="hint hit-link" href={pageOf("google", hit.work) ?? undefined} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={WORDS.openNamed(hit.title)}>
                    {WORDS.open}
                  </a>
                )}
              </li>
            ))}
          </ul>
          <Credit source={first.source} />
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
  const [state, setState] = useState<Fill | "nothing" | "changed">("idle");
  const [failure, setFailure] = useState<string[]>([]);
  const [kept, setKept] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const scans = useRef(turns());
  const box = useRef<HTMLDivElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const can = useCanScan();
  const { locked, guard } = useWriteLock();
  const latest = useRef(book);
  latest.current = book;
  useEffect(() => {
    if (pending !== null) keep.current?.focus();
  }, [pending]);
  const isbn = typeof book.data?.isbn === "string" ? book.data.isbn : null;
  const google = typeof book.data?.gb === "string" ? book.data.gb : null;
  const work = google ?? (typeof book.data?.ol === "string" ? book.data.ol : null);
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

  const dismiss = () => {
    setPending(null);
    box.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
  };

  const write = async (code: string) => {
    dismiss();
    setKept(true);
    const result = await actions.update("items", book.id, { data: { isbn: code } });
    setFailure(failureOf(result));
    if (result.ok) await run(code);
  };

  const choose = (choice: Choice) => {
    if (pending === null) return;
    const { write: code, changed } = decide(pending, choice, latest.current);
    dismiss();
    if (changed) setState("changed");
    if (code !== null) void write(code);
  };

  const onScan = async (code: string) => {
    const mine = scans.current.begin();
    setPending(null);
    setFailure([]);
    setState("busy");
    const step = await scanBook(lookup, code, () => latest.current);
    const next = landing(scans.current.latest(mine), step, code, latest.current);
    if (next.kind === "drop") return;
    if (next.kind === "write") return write(code);
    setState(next.state);
    setPending(next.pending);
  };

  const note = state === "busy" ? WORDS.filling : state === "done" ? WORDS.filled : state === "nothing" ? WORDS.nothingNew : notice(state);
  return (
    <div className="fill fill-page" ref={box} onKeyDown={(event) => dismisses(event.key, pending !== null, event.target instanceof Element && event.target.closest("dialog") !== null) && dismiss()}>
      {isbn !== null && (
        <button type="button" className="secondary" disabled={state === "busy"} aria-disabled={locked || undefined} onClick={guard(() => void run(isbn))}>
          {WORDS.fill}
        </button>
      )}
      <p className="hint look-note" role="status">
        {note}
      </p>
      {(isbn === null || kept) && <ScanIsbn writes onIsbn={(code) => void onScan(code)} />}
      {pending !== null && (
        <div className="replace" role="group" aria-label={WORDS.replace}>
          <p>{WORDS.replace}</p>
          <p className="hint">{WORDS.replaceBody(pending.old, pending.code)}</p>
          <button ref={keep} type="button" className="secondary" onClick={() => choose("keep")}>
            {WORDS.replaceNo}
          </button>
          <button type="button" onClick={() => choose("replace")}>
            {WORDS.replaceYes}
          </button>
        </div>
      )}
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
      {work !== null && <Credit source={google === null ? "openlibrary" : "google"} work={work} />}
    </div>
  );
}
