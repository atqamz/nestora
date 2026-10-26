import { screenOf } from "./routes.ts";
import type { Screen } from "./routes.ts";
import { text } from "./text.ts";

type Item = { section: string; icon: "place" | "heart" | "clock" | "book" | "settings"; label: string; screens: readonly Screen[]; rail?: true };

const items: Item[] = [
  { section: "", icon: "place", label: text.nav.home, screens: ["home"] },
  { section: "marriage", icon: "heart", label: text.nav.marriage, screens: ["marriage", "tasks", "money", "payments", "people"] },
  { section: "routines", icon: "clock", label: text.nav.routines, screens: ["routines"] },
  { section: "books", icon: "book", label: text.nav.library, screens: ["books", "movies", "series"] },
  { section: "settings", icon: "settings", label: text.nav.settings, screens: ["settings"], rail: true },
];

export const marriageTabs: readonly { section: string; label: string; screens: readonly Screen[] }[] = [
  { section: "marriage", label: text.marriage.journey, screens: ["marriage"] },
  { section: "tasks", label: text.tasks, screens: ["tasks"] },
  { section: "money", label: text.nav.money, screens: ["money", "payments"] },
  { section: "people", label: text.nav.people, screens: ["people"] },
];

export const libraryTabs: readonly { section: string; label: string; screens: readonly Screen[] }[] = [
  { section: "books", label: text.books.title, screens: ["books"] },
  { section: "movies", label: text.movies.title, screens: ["movies"] },
  { section: "series", label: text.series.title, screens: ["series"] },
];

export const navItems = (kind: "tabs" | "rail") => (kind === "rail" ? items : items.filter((item) => !item.rail));

export const isCurrent = (item: Item, section: string) => {
  const screen = screenOf(section);
  return screen !== null && item.screens.includes(screen);
};

export const navEntries = (kind: "tabs" | "rail"): (Item | "add")[] => {
  const list = navItems(kind);
  return kind === "rail" ? ["add", ...list] : [...list.slice(0, 2), "add", ...list.slice(2)];
};
