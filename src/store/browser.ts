import type { Side } from "../../shared/api.ts";
import { createApi } from "./api.ts";
import { indexedDbDisk } from "./db.ts";
import { createFeed } from "./feed.ts";
import { wirePage } from "./page.ts";
import { createSession, sideHint, timer } from "./partition.ts";
import { placeStore } from "./places.ts";
import { timerStore } from "./timers.ts";

export const tabStorage = (() => {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
})();

export const timers = timerStore(tabStorage);

export const places = placeStore(tabStorage, sideHint(localStorage).get);

export const feedOf = (side: Side) => createFeed((url, init) => fetch(url, init), side);

export const store = createSession({
  disk: indexedDbDisk(),
  hint: sideHint(localStorage),
  purge: (side) => {
    timers.purge(side);
    places.purge(side);
  },
  api: (side) => createApi((url, init) => fetch(url, init), side),
});

wirePage(store, { win: window, doc: document, nav: navigator, now: Date.now, later: timer });
