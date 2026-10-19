import { useId } from "react";
import type { ReactNode } from "react";
import type { Type } from "../../shared/tables.ts";

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
  onChange?: (value: string) => void;
};

const LIMITS: Partial<Record<string, number>> = { text: 500, longtext: 2000, note: 10000, url: 2048 };

const attributes = (type: Type, words?: true) =>
  type === "date"
    ? { type: "date" }
    : type === "phone"
      ? { type: "tel", inputMode: "tel" as const, autoComplete: "off", autoCapitalize: "none", spellCheck: false }
      : type === "url"
        ? { type: "url", inputMode: "url" as const, autoComplete: "off", autoCapitalize: "none", autoCorrect: "off", spellCheck: false }
        : type === "int"
          ? { type: "text", inputMode: "numeric" as const, autoComplete: "off", enterKeyHint: "done" as const }
          : type === "zone" || type === "isbn"
            ? { type: "text", autoComplete: "off", autoCapitalize: "none", spellCheck: false }
            : { type: "text", autoComplete: "off", autoCapitalize: words ? "words" : "sentences" };

export function Field({ control, error }: { control: Control; error?: string }) {
  const id = useId();
  const { name, label, type, value, required, options, choice, blank, blankIcon, suggestions, hint, words, onChange } = control;
  const shown = value === null || value === undefined || typeof value === "boolean" ? "" : String(value);
  const described = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  const common = { id, name, required, "aria-invalid": error ? true : undefined, "aria-describedby": described };
  const state = onChange ? { value: shown, onChange: (event: { target: { value: string } }) => onChange(event.target.value) } : { defaultValue: shown };
  const maxLength = typeof type === "string" ? LIMITS[type] : undefined;
  const notes = (
    <>
      {hint && (
        <p className="hint" id={`${id}-hint`}>
          {hint}
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
