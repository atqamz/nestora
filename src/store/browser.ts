import { createApi } from "./api.ts";
import { indexedDbDisk } from "./db.ts";
import { createSession, sideHint } from "./partition.ts";
import { timerStore } from "./timers.ts";

export const timers = timerStore(
  (() => {
    try {
      return sessionStorage;
    } catch {
      return null;
    }
  })(),
);

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
