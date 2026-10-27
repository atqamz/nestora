import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ChangeEvent } from "react";
import { batchesOf, changedBooks, detectFormat, previewOf, readInput, stepsOf } from "../domain/import-plan.ts";
import type { Batch, Entry, Format } from "../domain/import-plan.ts";
import { placesOf } from "../domain/places.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { useWriteLock } from "../hooks/use-write-lock.ts";
import { useLibrary } from "../hooks/use-books.ts";
import { useDetails } from "../hooks/use-details.ts";
import { usePartner, useSettings } from "../hooks/use-plan.ts";
import { actions, readItems } from "../hooks/use-store.ts";
import { announceImport, createAll, restoreImport, undoImport, undoneImports } from "../ui/book-import.ts";
import type { Undone } from "../ui/book-import.ts";
import { bookDefaults } from "../ui/book-save.ts";
import type { BookKind, BookOwner } from "../ui/book-save.ts";
import { ownerOptions, placeOptions } from "../ui/book-sheet.tsx";
import { failureOf } from "../ui/failure.ts";
import { Field } from "../ui/field.tsx";
import { formatDate } from "../ui/format.ts";
import { Icon } from "../ui/icons.tsx";
import { text } from "../ui/text.ts";
import { Title } from "../ui/title.tsx";

const WORDS = text.books.import;

const MAX_INPUT = 2_000_000;

const FORMATS: { pick: "auto" | Format; label: string }[] = [
  { pick: "auto", label: WORDS.detect },
  { pick: "list", label: WORDS.list },
  { pick: "csv", label: WORDS.csv },
];

function Source({ input, onInput, pick, onPick, format }: { input: string; onInput: (value: string) => void; pick: "auto" | Format; onPick: (pick: "auto" | Format) => void; format: Format }) {
  const ids = useId();
  const [problem, setProblem] = useState("");
  const load = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    if (file.size > MAX_INPUT) return setProblem(WORDS.fileTooBig);
    try {
      onInput(await file.text());
      setProblem("");
    } catch {
      setProblem(WORDS.fileFailed);
    }
  };
  return (
    <div className="form imp-form">
      <div className="field">
        <label htmlFor={`${ids}-paste`}>{WORDS.paste}</label>
        <textarea
          id={`${ids}-paste`}
          className="imp-paste"
          value={input}
          maxLength={MAX_INPUT}
          rows={6}
          spellCheck={false}
          autoComplete="off"
          aria-describedby={`${ids}-paste-hint`}
          onChange={(event) => onInput(event.target.value)}
        />
        <p className="hint" id={`${ids}-paste-hint`}>
          {WORDS.pasteHint}
        </p>
      </div>
      <div className="field">
        <label htmlFor={`${ids}-file`}>{WORDS.file}</label>
        <input id={`${ids}-file`} type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(event) => void load(event)} />
        {problem !== "" && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
      </div>
      <div className="field">
        <span id={`${ids}-format`} className="imp-label">
          {WORDS.format}
        </span>
        <div role="group" aria-labelledby={`${ids}-format`} className="seg imp-seg">
          {FORMATS.map((entry) => (
            <button key={entry.pick} type="button" aria-pressed={pick === entry.pick} onClick={() => onPick(entry.pick)}>
              {entry.label}
            </button>
          ))}
        </div>
        {input.trim() !== "" && (
          <p className="hint" role="status">
            {WORDS.reading(format === "csv" ? WORDS.csv : WORDS.list)}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ entry, on, onToggle }: { entry: Entry; on: boolean; onToggle: () => void }) {
  const { row, warnings } = entry;
  return (
    <li>
      <label className="imp-row">
        <input type="checkbox" checked={on} aria-label={WORDS.pick(row.title)} onChange={onToggle} />
        <span className="imp-text">
          <span className="title">{row.title}</span>
          {row.original_title !== "" && <span className="bk-by">{text.books.original(row.original_title)}</span>}
          {row.author !== "" && <span className="bk-by">{WORDS.by(row.author)}</span>}
          {row.rated_elsewhere !== "" && <span className="bk-by">{text.books.ratedElsewhere(row.rated_elsewhere)}</span>}
          {warnings.length > 0 && (
            <span className="imp-warns">
              {warnings.map((warning) => (
                <span key={warning} className="imp-warn" data-warning={warning}>
                  {WORDS.warning[warning]}
                </span>
              ))}
            </span>
          )}
        </span>
      </label>
    </li>
  );
}

function Earlier({ batch, changed }: { batch: Batch; changed: number }) {
  const { busy, once } = useBusy();
  const { locked, guard } = useWriteLock();
  const [confirming, setConfirming] = useState(false);
  const ask = useRef<HTMLButtonElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);
  const noted = useId();
  useEffect(() => {
    if (confirming) {
      asked.current = true;
      keep.current?.focus();
    } else if (asked.current) {
      asked.current = false;
      ask.current?.focus();
    }
  }, [confirming]);
  const { state, remaining, tried, start, stop } = useDetails(batch.id, batch.books);
  const [failure, setFailure] = useState<string[]>([]);
  const day = formatDate(batch.at.slice(0, 10));
  const undo = async () => {
    const result = await undoImport(batch.id, readItems, actions.many);
    setFailure(failureOf(result));
    if (result.ok) setConfirming(false);
  };
  const again = tried > 0 || state.phase === "stopped" || state.phase === "offline" || state.phase === "busy";
  const going = state.phase === "running" || state.phase === "stopping";
  const progress =
    state.phase === "running"
      ? WORDS.progress(state.done, state.total, state.tally.unsure)
      : state.phase === "stopping"
        ? WORDS.stopping
        : state.phase === "stopped"
          ? `${WORDS.stopped} ${WORDS.progress(state.done, state.total, state.tally.unsure)}`
          : state.phase === "offline"
            ? WORDS.offline
            : state.phase === "busy"
              ? WORDS.busy
              : state.phase === "finished"
                ? WORDS.finished(state.tally.filled, state.tally.empty + state.tally.failed, state.tally.unsure)
                : remaining === 0
                ? WORDS.nothingToFind
                : "";
  return (
    <li className="imp-batch">
      <p className="imp-line">{WORDS.earlierLine(batch.books.length, day)}</p>
      <div className="imp-acts">
        {going ? (
          <button type="button" className="secondary" disabled={state.phase === "stopping"} onClick={stop}>
            {WORDS.stop}
          </button>
        ) : (
          remaining > 0 && (
            <button type="button" className="secondary" aria-disabled={locked || undefined} aria-label={again ? undefined : WORDS.findNamed(day)} onClick={guard(() => void start())}>
              {again ? WORDS.resume : WORDS.find}
            </button>
          )
        )}
        {!confirming && (
          <button
            ref={ask}
            type="button"
            className="secondary"
            disabled={busy || going}
            aria-disabled={locked || undefined}
            aria-label={WORDS.undoNamed(day)}
            onClick={guard(() => void (changed > 0 ? setConfirming(true) : once(undo)))}
          >
            {WORDS.undo}
          </button>
        )}
      </div>
      {confirming && (
        <div className="imp-confirm" role="group" aria-labelledby={noted}>
          <p id={noted} className="imp-line">
            {WORDS.changed(changed)}
          </p>
          <div className="imp-acts">
            <button ref={keep} type="button" className="secondary" aria-label={WORDS.keepNamed(day)} onClick={() => setConfirming(false)}>
              {WORDS.keep}
            </button>
            <button type="button" className="secondary" disabled={busy} aria-label={WORDS.undoAnywayNamed(day)} onClick={() => once(undo)}>
              {WORDS.undoAnyway}
            </button>
          </div>
        </div>
      )}
      <p className="hint imp-progress" role="status">
        {progress}
      </p>
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
    </li>
  );
}

function Hidden({ entry }: { entry: Undone }) {
  const { busy, once } = useBusy();
  const { locked, guard } = useWriteLock();
  const [failure, setFailure] = useState<string[]>([]);
  const day = formatDate(entry.at.slice(0, 10));
  return (
    <li className="imp-batch">
      <p className="imp-line">{WORDS.undoneLine(entry.books.length, day)}</p>
      <div className="imp-acts">
        <button type="button" className="secondary" disabled={busy} aria-disabled={locked || undefined} aria-label={WORDS.restoreNamed(day)} onClick={guard(() => void once(async () => setFailure(failureOf(await restoreImport(entry.batch, actions.many)))))}>
          {WORDS.restore}
        </button>
      </div>
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
    </li>
  );
}

export function ImportBooks() {
  const { items } = useLibrary();
  const { me, label } = usePartner();
  const settings = useSettings();
  const { busy, once } = useBusy();
  const { locked, guard } = useWriteLock();
  const [input, setInput] = useState("");
  const [pick, setPick] = useState<"auto" | Format>("auto");
  const [kind, setKind] = useState<BookKind>("wish");
  const [ownerPick, setOwnerPick] = useState<BookOwner | null>(null);
  const [placePick, setPlacePick] = useState<string | null>(null);
  const [toggles, setToggles] = useState<ReadonlyMap<number, boolean>>(new Map());
  const [failure, setFailure] = useState<string[]>([]);
  const [imported, setImported] = useState(0);
  const heard = useDeferredValue(input);
  const format = pick === "auto" ? detectFormat(heard) : pick;
  const read = useMemo(() => readInput(heard, format), [heard, format]);
  const entries = useMemo(() => previewOf(read.rows, items), [read, items]);
  const batches = useMemo(() => batchesOf(items), [items]);
  const gone = useSyncExternalStore(undoneImports.subscribe, undoneImports.get);
  const hidden = useMemo(() => gone.filter((entry) => !batches.some((batch) => batch.id === entry.batch)), [gone, batches]);
  const places = useMemo(() => placesOf(items), [items]);
  const { owner, placeId } = bookDefaults({ kind, ownerPick, placePick }, items, me);
  const ticked = entries.filter((entry) => toggles.get(entry.key) ?? entry.checked);
  const waiting = input !== heard;

  const change = (value: string) => {
    setInput(value);
    setToggles(new Map());
    setImported(0);
  };

  const tick = (all: boolean) => setToggles(new Map(entries.map((entry) => [entry.key, all])));

  const run = () =>
    once(async () => {
      const batch = crypto.randomUUID();
      const steps = stepsOf(ticked, { kind, owner, placeId: placeId === "" ? null : placeId }, { items, labels: { a: settings.partnerA ?? "", b: settings.partnerB ?? "" }, batch, id: () => crypto.randomUUID() });
      const result = await createAll(steps, actions.many);
      setFailure(failureOf(result));
      if (!result.ok) return;
      announceImport(batch, ticked.length, readItems, actions.many);
      setInput("");
      setToggles(new Map());
      setImported(ticked.length);
    });

  return (
    <>
      <p className="trail">
        <a href="#/books">
          <Icon name="back" />
          {WORDS.back}
        </a>
      </p>
      <Title>{WORDS.title}</Title>
      <p className="hint">{WORDS.intro}</p>
      <Source input={input} onInput={change} pick={pick} onPick={(next) => (setPick(next), setToggles(new Map()))} format={format} />
      <section aria-labelledby="imp-where">
        <h2 id="imp-where">{WORDS.where}</h2>
        <div role="group" aria-label={text.books.sheet.kind} className="kinds">
          {(["wish", "shelf"] as const).map((name) => (
            <button key={name} type="button" aria-pressed={kind === name} onClick={() => setKind(name)}>
              <Icon name={name === "shelf" ? "book" : "star"} />
              {text.books.sheet[name]}
            </button>
          ))}
        </div>
        <div className="form bk-form">
          <Field control={{ name: "owner", label: text.books.sheet.owner[kind], type: "text", required: true, choice: true, value: owner, onChange: (value) => setOwnerPick(value as BookOwner), options: ownerOptions(label) }} />
          {kind === "shelf" && (
            <Field control={{ name: "place", label: text.books.sheet.place, type: "text", value: placeId, blank: text.books.noPlace, options: placeOptions(places), onChange: setPlacePick }} />
          )}
        </div>
      </section>
      {read.problem !== null && input.trim() !== "" && !waiting && (
        <p className="imp-problem" role="status">
          {WORDS.problems[read.problem]}
        </p>
      )}
      {entries.length > 0 && (
        <section aria-labelledby="imp-preview">
          <h2 id="imp-preview">{WORDS.preview}</h2>
          {read.skipped > 0 && <p className="hint">{WORDS.skipped(read.skipped)}</p>}
          {read.over > 0 && <p className="hint">{WORDS.over(entries.length, read.over)}</p>}
          <p className="hint" role="status">
            {WORDS.summary(ticked.length, entries.length)}
          </p>
          <div className="imp-bar">
            <button type="button" disabled={busy || ticked.length === 0} aria-disabled={locked || undefined} onClick={guard(() => void run())}>
              <Icon name="upload" />
              {busy ? WORDS.running : WORDS.run(ticked.length)}
            </button>
            <button type="button" className="secondary" onClick={() => tick(true)}>
              {WORDS.all}
            </button>
            <button type="button" className="secondary" onClick={() => tick(false)}>
              {WORDS.none}
            </button>
          </div>
          <ul className="imp-rows" aria-label={WORDS.rows}>
            {entries.map((entry) => (
              <Row key={entry.key} entry={entry} on={toggles.get(entry.key) ?? entry.checked} onToggle={() => setToggles(new Map(toggles).set(entry.key, !(toggles.get(entry.key) ?? entry.checked)))} />
            ))}
          </ul>
        </section>
      )}
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
      {imported > 0 && (
        <p className="imp-done" role="status">
          {text.books.import.done(imported)}. {WORDS.imported}
        </p>
      )}
      {(batches.length > 0 || hidden.length > 0) && (
        <section aria-labelledby="imp-earlier">
          <h2 id="imp-earlier">{WORDS.earlier}</h2>
          <p className="hint">{WORDS.findHint}</p>
          <ul className="imp-batches">
            {batches.map((batch) => (
              <Earlier key={batch.id} batch={batch} changed={changedBooks(items, batch.id)} />
            ))}
            {hidden.map((entry) => (
              <Hidden key={entry.batch} entry={entry} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
