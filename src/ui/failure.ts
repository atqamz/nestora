import type { Written } from "../hooks/use-store.ts";
import { text } from "./text.ts";

export const failureOf = (result: Written): string[] => (result.ok ? [] : result.storage ? [text.storageFailed] : result.paused ? [text.paused] : result.errors);

export const splitErrors = (errors: readonly string[], names: readonly string[]) => {
  const fields: Record<string, string> = {};
  const rest: string[] = [];
  for (const error of errors) {
    const at = error.indexOf(": ");
    const name = at < 0 ? "" : error.slice(0, at);
    if (names.includes(name)) fields[name] ??= error.slice(at + 2);
    else rest.push(error);
  }
  return { fields, rest };
};
