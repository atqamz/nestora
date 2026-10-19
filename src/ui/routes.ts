export type Screen = "home" | "tasks" | "money" | "payments" | "people" | "books" | "settings" | "sync";

export const screens: Readonly<Record<string, Screen>> = {
  "": "home",
  tasks: "tasks",
  money: "money",
  budget: "money",
  payments: "payments",
  people: "people",
  guests: "people",
  vendors: "people",
  books: "books",
  wishlist: "books",
  places: "books",
  settings: "settings",
  sync: "sync",
};

export const screenOf = (section: string): Screen | null => (Object.hasOwn(screens, section) ? screens[section] : null);
