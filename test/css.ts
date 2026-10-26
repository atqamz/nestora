import { readFileSync } from "node:fs";

export type Rule = { query: string | null; selectors: string[]; declarations: [string, string][] };

const squash = (value: string) => value.trim().replace(/\s+/g, " ");

const splitTop = (text: string, separator: string) => {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (quote) quote = char === quote ? "" : quote;
    else if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, at));
      start = at + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.filter((part) => part.trim() !== "");
};

const declarationsOf = (body: string): [string, string][] =>
  splitTop(body, ";").map((entry) => {
    const colon = entry.indexOf(":");
    return [entry.slice(0, colon).trim().toLowerCase(), squash(entry.slice(colon + 1))];
  });

const closing = (text: string, open: number) => {
  let depth = 0;
  let quote = "";
  for (let at = open; at < text.length; at++) {
    const char = text[at];
    if (quote) quote = char === quote ? "" : quote;
    else if (char === '"' || char === "'") quote = char;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return at;
  }
  throw new Error("unclosed block");
};

const rulesOf = (text: string, query: string | null): Rule[] => {
  const rules: Rule[] = [];
  for (let at = 0; at < text.length; ) {
    const open = text.indexOf("{", at);
    if (open < 0) break;
    const head = squash(text.slice(at, open));
    const end = closing(text, open);
    const body = text.slice(open + 1, end);
    if (head.startsWith("@media") || head.startsWith("@container")) rules.push(...rulesOf(body, head));
    else if (!head.startsWith("@")) rules.push({ query, selectors: splitTop(head, ",").map(squash), declarations: declarationsOf(body) });
    at = end + 1;
  }
  return rules;
};

export const sheet = (path: string): Rule[] => rulesOf(readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""), null);

const active = (query: string | null, width: number) => {
  if (query === null) return true;
  if (!query.startsWith("@media")) return false;
  return [...query.matchAll(/\((min|max)-width:\s*([\d.]+)rem\)/g)].every(([, bound, rem]) => (bound === "min" ? width >= Number(rem) : width <= Number(rem)));
};

export const cascade = (rules: Rule[], selector: string, width: number) => {
  const final = new Map<string, string>();
  for (const rule of rules)
    if (active(rule.query, width) && rule.selectors.includes(selector)) for (const [property, value] of rule.declarations) final.set(property, value);
  return final;
};

export const queries = (rules: Rule[]) => [...new Set(rules.flatMap((rule) => (rule.query === null ? [] : [rule.query])))];
