import { marriageTabs } from "./nav.ts";
import type { Screen } from "./routes.ts";
import { text } from "./text.ts";

export function MarriageTabs({ screen }: { screen: Screen }) {
  return (
    <nav className="space-tabs" aria-label={text.marriage.label}>
      {marriageTabs.map((tab) => (
        <a key={tab.section} href={`#/${tab.section}`} aria-current={tab.screens.includes(screen) ? "page" : undefined}>
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
