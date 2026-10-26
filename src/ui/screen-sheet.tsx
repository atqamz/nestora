import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { COLLECTION_MAX } from "../../shared/tables.ts";
import { collectionNames } from "../domain/collection.ts";
import { START, parseYear } from "../domain/screen.ts";
import type { ScreenKind } from "../domain/screen.ts";
import { adopt, heldIds, heldPick, letGo } from "../domain/tmdb.ts";
import type { Picked, ScreenHit } from "../domain/tmdb.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { useScreenSearch } from "../hooks/use-lookup.ts";
import { usePartner, useStamp, useTmdbDay } from "../hooks/use-plan.ts";
import { actions, useTable } from "../hooks/use-store.ts";
import { ownerOptions } from "./book-sheet.tsx";
import { failureOf } from "./failure.ts";
import { Field } from "./field.tsx";
import { Icon } from "./icons.tsx";
import { Modal } from "./modal.tsx";
import { overlay } from "./overlay.ts";
import { ScreenLookup } from "./screen-lookup.tsx";
import { collectionProblem, saveScreen, screenProblems } from "./screen-save.ts";
import type { ScreenInput } from "./screen-save.ts";
import { text } from "./text.ts";

export function ScreenSheet({ kind, onClose }: { kind: ScreenKind; onClose: () => void }) {
  const items = useTable("items");
  const { label } = usePartner();
  const stamp = useStamp();
  const tmdbDay = useTmdbDay();
  const { busy, once } = useBusy();
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [status, setStatus] = useState<ScreenInput["status"]>("want");
  const [collection, setCollection] = useState("");
  const [who, setWho] = useState<ScreenInput["who"]>("both");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [filled, setFilled] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(false);
  const [failure, setFailure] = useState<string[]>([]);
  const words = kind === "movie" ? text.movies : text.series;
  const problems = screenProblems(title, year);
  const collectionError = collectionProblem(collection);
  const settled = heldPick(picked, title);
  const typedYear = parseYear(year);
  const search = useScreenSearch({ kind, title, year: typedYear.ok ? typedYear.value : null }, settled === null);

  useEffect(() => {
    const gone = letGo(picked, title, year, filled);
    if (gone === null) return;
    setPicked(null);
    setYear(gone.year);
    setFilled(null);
  }, [picked, title, year, filled]);

  const pick = (hit: ScreenHit) => {
    const next = adopt({ year }, hit);
    setTitle(next.title);
    setYear(next.year);
    setFilled(next.filled);
    setPicked(next.picked);
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttempt(true);
    if (problems.title !== undefined || problems.year !== undefined || collectionError !== undefined) return;
    return once(async () => {
      const result = await saveScreen(items, actions.create, { kind, title, year, status, who, collection, picked: settled }, stamp(), tmdbDay());
      setFailure(failureOf(result));
      if (!result.ok) return;
      overlay.announce(text.screen.added(title.trim()));
      onClose();
    });
  };

  return (
    <Modal
      title={words.sheetTitle}
      onClose={onClose}
      onSubmit={save}
      foot={
        <button type="submit" disabled={busy}>
          {search.hits.length > 0 ? text.screen.sheet.asTyped : text.screen.sheet.save}
        </button>
      }
    >
      <div role="group" aria-label={text.screen.sheet.kind} className="kinds">
        {START.map((pick) => (
          <button key={pick} type="button" aria-pressed={status === pick} onClick={() => setStatus(pick)}>
            <Icon name={pick === "want" ? "play" : "check"} />
            {text.screen.pick[pick]}
          </button>
        ))}
      </div>
      <div className="form bk-form">
        <Field
          control={{ name: "title", label: text.screen.sheet.title, type: "text", required: true, words: true, value: title, onChange: setTitle }}
          error={attempt ? problems.title : undefined}
        />
        <Field control={{ name: "year", label: text.screen.sheet.year, type: "year", value: year, onChange: (value) => (setYear(value), setFilled(null)) }} error={attempt ? problems.year : undefined} />
        <ScreenLookup kind={kind} search={search} have={heldIds(items, kind)} onPick={pick} />
        <Field
          control={{
            name: "collection",
            label: text.screen.collection.label,
            type: "text",
            words: true,
            max: COLLECTION_MAX,
            hint: text.screen.collection.hint,
            value: collection,
            onChange: setCollection,
            suggestions: collectionNames(items, kind),
          }}
          error={attempt ? collectionError : undefined}
        />
        <Field
          control={{
            name: "who",
            label: text.screen.sheet.owner,
            type: "text",
            required: true,
            choice: true,
            value: who,
            onChange: (value) => setWho(value as ScreenInput["who"]),
            options: ownerOptions(label),
          }}
        />
      </div>
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
    </Modal>
  );
}
