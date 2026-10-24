import { createApi } from "./api.ts";
import { indexedDbDisk } from "./db.ts";
import { createSession, sideHint } from "./partition.ts";

export const store = createSession({
  disk: indexedDbDisk(),
  hint: sideHint(localStorage),
  api: (side) => createApi((url, init) => fetch(url, init), side),
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void store.sync();
});

addEventListener("online", () => void store.sync());
