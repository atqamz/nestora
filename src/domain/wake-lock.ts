export type WakeState = "idle" | "held" | "unavailable";

type Sentinel = { release: () => Promise<void>; addEventListener: (type: "release", listener: () => void) => void };

export type WakeApi = { request: (type: "screen") => Promise<Sentinel> };

const quiet = () => {};

export const keepAwake = (api: WakeApi | undefined, report: (state: WakeState) => void) => {
  let sentinel: Sentinel | null = null;
  let pending = false;
  let wanted = false;

  const acquire = async () => {
    wanted = true;
    if (api === undefined) return report("unavailable");
    if (sentinel !== null || pending) return;
    pending = true;
    try {
      const got = await api.request("screen");
      if (!wanted) return void (await got.release().catch(quiet));
      sentinel = got;
      got.addEventListener("release", () => {
        if (sentinel === got) {
          sentinel = null;
          report("idle");
        }
      });
      report("held");
    } catch {
      report("unavailable");
    } finally {
      pending = false;
    }
  };

  const release = async () => {
    wanted = false;
    const held = sentinel;
    sentinel = null;
    report("idle");
    await held?.release().catch(quiet);
  };

  return { acquire, release };
};
