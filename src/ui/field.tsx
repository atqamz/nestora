import { useId, useState } from "react";
import type { ReactNode } from "react";
import type { Type } from "../../shared/tables.ts";
import { attributes } from "./field-attributes.ts";
import { isbnNote } from "./isbn-note.ts";

export type Control = {
  name: string;
  label: string;
  type: Type;
  value?: string | number | boolean | null;
  required?: boolean;
  options?: readonly { value: string; label: string; icon?: ReactNode }[] | null;
  choice?: true;
  blank?: string;
  blankIcon?: ReactNode;
  suggestions?: readonly string[];
  hint?: string;
  words?: true;
  max?: number;
  onChange?: (value: string) => void;
};

const LIMITS: Partial<Record<string, number>> = { text: 500, longtext: 2000, note: 10000, url: 2048 };

export function Field({ control, error }: { control: Control; error?: string }) {
  const id = useId();
  const { name, label, type, value, required, options, choice, blank, blankIcon, suggestions, hint, words, max, onChange } = control;
  const shown = value === null || value === undefined || typeof value === "boolean" ? "" : String(value);
  const [typed, setTyped] = useState<string | null>(null);
  const note = type === "isbn" ? isbnNote(onChange ? shown : (typed ?? shown)) : hint;
  const described = [note ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  const common = { id, name, required, "aria-invalid": error ? true : undefined, "aria-describedby": described };
  const change = (event: { target: { value: string } }) => (setTyped(event.target.value), onChange?.(event.target.value));
  const state = onChange ? { value: shown, onChange: change } : { defaultValue: shown, onChange: change };
  const maxLength = max ?? (typeof type === "string" ? LIMITS[type] : undefined);
  const notes = (
    <>
      {note && (
        <p className="hint" id={`${id}-hint`}>
          {note}
        </p>
      )}
      {error && (
        <p className="error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </>
  );
  if (type === "bool") {
    return (
      <div className="field check-field">
        <label>
          <input type="checkbox" name={name} defaultChecked={value === true} /> {label}
        </label>
      </div>
    );
  }
  if (options && choice) {
    const all = required ? options : [{ value: "", label: blank ?? "", icon: blankIcon }, ...options];
    return (
      <fieldset className="field choice-field" aria-describedby={described}>
        <legend>{label}</legend>
        <div className="choices">
          {all.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name={name}
                value={option.value}
                {...(onChange ? { checked: shown === option.value, onChange: () => onChange(option.value) } : { defaultChecked: shown === option.value })}
              />
              <span>
                {option.icon}
                {option.label}
              </span>
            </label>
          ))}
        </div>
        {notes}
      </fieldset>
    );
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {options ? (
        <select {...common} {...state}>
          {!required && <option value="">{blank}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : type === "note" ? (
        <textarea {...common} {...state} rows={3} maxLength={maxLength} autoCapitalize="sentences" />
      ) : (
        <input {...common} {...attributes(type, words)} {...state} maxLength={maxLength} list={suggestions ? `${id}-list` : undefined} />
      )}
      {suggestions && (
        <datalist id={`${id}-list`}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      )}
      {notes}
    </div>
  );
}
