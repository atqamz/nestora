import type { Side } from "../shared/api.ts";
import type { Fetch } from "../src/store/api.ts";
import worker from "../worker/index.ts";
import type { Bindings } from "../worker/index.ts";
import { createDb } from "./sync-db.ts";

export const createWorkerServer = () => {
  const { db, sqlite, calls } = createDb();
  const control = { date: (() => new Date().toUTCString()) as (() => string) | null };
  const DESIGN: Bindings["DESIGN"] = { get: async () => null };
  const as =
    (who: Side): Fetch =>
    async (url, init) => {
      const res = await worker.fetch(new Request(new URL(url, "https://wp.example.test"), init), { DB: db, DESIGN, AUTH_MODE: "dev", DEV_WHO: who });
      const dated = new Response(res.body, res);
      if (control.date !== null) dated.headers.set("date", control.date());
      return dated;
    };
  return { as, control, db, sqlite, calls };
};

export type WorkerServer = ReturnType<typeof createWorkerServer>;
