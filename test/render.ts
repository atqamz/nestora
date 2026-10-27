import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const stub = new URL("./render-store.ts", import.meta.url).href;

let installed = false;

const install = () => {
  if (installed) return;
  installed = true;
  registerHooks({
    resolve: (specifier, context, next) => (/(^|\/)(use-store|browser)\.ts$/.test(specifier) ? { url: stub, shortCircuit: true } : next(specifier, context)),
    load: (url, context, next) =>
      url.endsWith(".tsx")
        ? { format: "module", shortCircuit: true, source: transformSync(readFileSync(fileURLToPath(url), "utf8"), { loader: "tsx", jsx: "automatic", format: "esm", sourcefile: url }).code }
        : next(url, context),
  });
};

export const load = async (module: string) => {
  install();
  return (await import(new URL(`../src/${module}`, import.meta.url).href)) as Record<string, any>;
};

export const markupOf = async (module: string, render: (loaded: Record<string, any>) => ReactElement) => renderToStaticMarkup(render(await load(module)));
