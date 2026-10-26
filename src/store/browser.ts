import type { Side } from "../../shared/api.ts";
import { createApi } from "./api.ts";
import { indexedDbDisk } from "./db.ts";
import { createFeed } from "./feed.ts";
import { createSession, sideHint } from "./partition.ts";
import { timerStore } from "./timers.ts";

export const tabStorage = (() => {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
})();

export const timers = timerStore(tabStorage);

export const feedOf = (side: Side) => createFeed((url, init) => fetch(url, init), side);

export const store = createSession({
  disk: indexedDbDisk(),
  hint: sideHint(localStorage),
  purge: timers.purge,
  api: (side) => createApi((url, init) => fetch(url, init), side),
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void store.sync();
});

addEventListener("online", () => void store.sync());
