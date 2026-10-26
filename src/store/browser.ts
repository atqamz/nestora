import type { Side } from "../../shared/api.ts";
import { createApi } from "./api.ts";
import { indexedDbDisk } from "./db.ts";
import { createFeed } from "./feed.ts";
import { createLive } from "./live.ts";
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

export const feedOf = (side: Side) => createFeed((url, init) => fetch(url, init), side);

export const store = createSession({
  disk: indexedDbDisk(),
  hint: sideHint(localStorage),
  purge: timers.purge,
  api: (side) => createApi((url, init) => fetch(url, init), side),
});

const live = createLive({
  sync: store.poll,
  read: store.getSnapshot,
  now: Date.now,
  later: (run, ms) => {
    const handle = setTimeout(() => void run(), ms);
    return () => clearTimeout(handle);
  },
  visible: () => document.visibilityState === "visible",
  online: () => navigator.onLine !== false,
});

const wake = () => {
  if (document.visibilityState === "visible" && !live.trigger()) void store.sync();
};

addEventListener("pointerdown", live.touch, { passive: true, capture: true });
addEventListener("keydown", live.touch, { passive: true, capture: true });
document.addEventListener("visibilitychange", () => (document.visibilityState === "visible" ? wake() : live.stop()));
addEventListener("pageshow", wake);
addEventListener("focus", wake);
addEventListener("online", wake);
