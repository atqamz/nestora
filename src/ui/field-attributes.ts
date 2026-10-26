import type { Type } from "../../shared/tables.ts";

export const attributes = (type: Type, words?: true) =>
  type === "date" || type === "time"
    ? { type }
    : type === "phone"
      ? { type: "tel", inputMode: "tel" as const, autoComplete: "off", autoCapitalize: "none", spellCheck: false }
      : type === "url"
        ? { type: "url", inputMode: "url" as const, autoComplete: "off", autoCapitalize: "none", autoCorrect: "off", spellCheck: false }
        : type === "int" || type === "year"
          ? { type: "text", inputMode: "numeric" as const, autoComplete: "off", enterKeyHint: "done" as const }
          : type === "zone" || type === "isbn"
            ? { type: "text", autoComplete: "off", autoCapitalize: "none", spellCheck: false }
            : { type: "text", autoComplete: "off", autoCapitalize: words ? "words" : "sentences" };
