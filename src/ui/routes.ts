export type Screen = "home" | "marriage" | "tasks" | "routines" | "money" | "payments" | "people" | "books" | "movies" | "series" | "settings" | "sync";

export const screens: Readonly<Record<string, Screen>> = {
  "": "home",
  marriage: "marriage",
  tasks: "tasks",
  routines: "routines",
  money: "money",
  budget: "money",
  payments: "payments",
  people: "people",
  guests: "people",
  vendors: "people",
  books: "books",
  wishlist: "books",
  places: "books",
  movies: "movies",
  series: "series",
  settings: "settings",
  sync: "sync",
};

export const screenOf = (section: string): Screen | null => (Object.hasOwn(screens, section) ? screens[section] : null);
