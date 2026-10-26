import type { Later } from "./partition.ts";
import type { Snapshot } from "./store.ts";

const ACTIVE_MS = 10_000;
const IDLE_MS = 30_000;
const CAP_MS = 60_000;
const IDLE_AFTER_MS = 60_000;
const VERY_IDLE_AFTER_MS = 600_000;
export const TRIGGER_GAP_MS = 2_000;

export const delayOf = (idle: number, failures: number) =>
  Math.min((idle < IDLE_AFTER_MS ? ACTIVE_MS : idle < VERY_IDLE_AFTER_MS ? IDLE_MS : CAP_MS) * 2 ** failures, CAP_MS);

export type Live = { touch: () => void; trigger: () => boolean; stop: () => void };

export const createLive = ({
  sync,
  read,
  now,
  later,
  visible,
  online,
}: {
  sync: () => Promise<boolean>;
  read: () => Pick<Snapshot, "link" | "paused">;
  now: () => number;
  later: Later;
  visible: () => boolean;
  online: () => boolean;
}): Live => {
  let input = now();
  let began = -Infinity;
  let failures = 0;
  let running = false;
  let waiting = false;
  let cancel = () => {};

  const eligible = () => {
    const { link, paused } = read();
    return visible() && online() && !paused && (link === "online" || link === "offline");
  };

  const stop = () => {
    cancel();
    cancel = () => {};
    waiting = false;
  };

  const arm = () => {
    stop();
    if (visible() && online()) {
      waiting = true;
      cancel = later(async () => ((waiting = false), eligible() ? pull() : arm()), delayOf(now() - input, failures));
    }
  };

  const pull = async () => {
    stop();
    running = true;
    began = now();
    const reached = await sync().catch(() => false);
    running = false;
    failures = reached ? 0 : failures + 1;
    arm();
  };

  arm();

  return {
    touch: () => void (input = now()),
    trigger: () => {
      const ready = eligible();
      if (ready && !running && now() - began >= Math.min(TRIGGER_GAP_MS * 2 ** failures, CAP_MS)) void pull();
      else if (!running && !waiting) arm();
      return ready;
    },
    stop,
  };
};
