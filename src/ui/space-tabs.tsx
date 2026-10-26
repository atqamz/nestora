import { libraryTabs } from "./nav.ts";
import type { Screen } from "./routes.ts";
import { text } from "./text.ts";

type Tab = { section: string; label: string; screens: readonly Screen[] };

export function SpaceTabs({ tabs, label, screen }: { tabs: readonly Tab[]; label: string; screen: Screen }) {
  return (
    <nav className="space-tabs" aria-label={label}>
      {tabs.map((tab) => (
        <a key={tab.section} href={`#/${tab.section}`} aria-current={tab.screens.includes(screen) ? "page" : undefined}>
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

export const LibraryTabs = ({ screen }: { screen: Screen }) => <SpaceTabs tabs={libraryTabs} label={text.nav.library} screen={screen} />;
