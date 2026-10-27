import { readFileSync } from "node:fs";

type Rule = { max: number | null; selectors: string[]; declarations: Map<string, string> };

const rulesOf = (path: string): Rule[] => {
  const css = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  const read = (text: string, max: number | null) => {
    let rest = text;
    while (rest.trim() !== "") {
      const open = rest.indexOf("{");
      const head = rest.slice(0, open).trim();
      let depth = 1;
      let close = open + 1;
      while (depth > 0) depth += rest[close++] === "{" ? 1 : rest[close - 1] === "}" ? -1 : 0;
      const body = rest.slice(open + 1, close - 1);
      rest = rest.slice(close);
      const query = /^@media \(max-width: ([\d.]+)rem\)$/.exec(head);
      if (query) read(body, Number(query[1]));
      else if (!head.startsWith("@"))
        rules.push({ max, selectors: head.split(",").map((selector) => selector.trim()), declarations: new Map([...body.matchAll(/([a-z-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()])) });
    }
  };
  read(css, null);
  return rules;
};

export const cascade = (path: string, selector: string, rem: number) => {
  const found = new Map<string, string>();
  for (const rule of rulesOf(path)) if (rule.selectors.includes(selector) && (rule.max === null || rem <= rule.max)) for (const [property, value] of rule.declarations) found.set(property, value);
  return found;
};
