import { toIsbn13 } from "./isbn.ts";

export type Track = { stop(): void };

export type Stream = { getTracks(): Track[] };

export type Detector = { detect(frame: unknown): Promise<readonly { rawValue?: string }[]> };

export type Timer = { every(run: () => void, ms: number): () => void; after(run: () => void, ms: number): () => void };

export type Refusal = "denied" | "none" | "busy" | "insecure" | "unsupported" | "failed";

export type Scanned = { kind: "found"; isbn: string } | { kind: Refusal | "slow" | "closed" };

export type Deps = {
  secure: boolean;
  camera: boolean;
  getStream: () => Promise<Stream>;
  detector: Detector;
  view: { show(stream: Stream): void; frame(): unknown };
  timer: Timer;
  interval?: number;
  limit?: number;
};

export const INTERVAL = 200;

export const LIMIT = 60_000;

export const timer: Timer = {
  every: (run, ms) => {
    const id = setInterval(run, ms);
    return () => clearInterval(id);
  },
  after: (run, ms) => {
    const id = setTimeout(run, ms);
    return () => clearTimeout(id);
  },
};

export const accept = (values: readonly string[]): string | null => values.find((value) => /^97[89]\d{10}$/.test(value) && toIsbn13(value) === value) ?? null;

export const fresh = (current: string, code: string) => toIsbn13(current) !== code;

export const refusal = (error: unknown): Refusal => {
  const name = error instanceof Error ? error.name : "";
  return name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" || name === "OverconstrainedError" ? "none" : name === "NotReadableError" || name === "AbortError" ? "busy" : "failed";
};

export const scan = ({ secure, camera, getStream, detector, view, timer, interval = INTERVAL, limit = LIMIT }: Deps) => {
  let ended = false;
  let stream: Stream | null = null;
  let release = () => {};
  let finish!: (outcome: Scanned) => void;
  const result = new Promise<Scanned>((resolve) => {
    finish = (outcome) => {
      if (ended) return;
      ended = true;
      release();
      stream?.getTracks().forEach((track) => track.stop());
      resolve(outcome);
    };
  });
  const blocked = !secure ? "insecure" : !camera ? "unsupported" : null;
  if (blocked !== null) finish({ kind: blocked });
  else
    void Promise.resolve()
      .then(getStream)
      .then(
      (got) => {
        if (ended) return got.getTracks().forEach((track) => track.stop());
        stream = got;
        view.show(got);
        let looking = false;
        const stopEvery = timer.every(async () => {
          const frame = view.frame();
          if (looking || frame === null) return;
          looking = true;
          try {
            const isbn = accept((await detector.detect(frame)).map((code) => code.rawValue ?? ""));
            if (isbn !== null) finish({ kind: "found", isbn });
          } catch {
            finish({ kind: "failed" });
          } finally {
            looking = false;
          }
        }, interval);
        const stopAfter = timer.after(() => finish({ kind: "slow" }), limit);
        release = () => (stopEvery(), stopAfter());
      },
      (error) => finish({ kind: refusal(error) }),
    );
  return { result, stop: () => finish({ kind: "closed" }) };
};

const HAVE_CURRENT_DATA = 2;

export const frameOf = <T extends { readyState: number; videoWidth: number }>(video: T): T | null => (video.readyState >= HAVE_CURRENT_DATA && video.videoWidth > 0 ? video : null);

type Target = { addEventListener(type: string, run: () => void): void; removeEventListener(type: string, run: () => void): void };

export const camera = (deps: Deps, page: Target, doc: Target & { hidden: boolean }, done: (outcome: Scanned) => void) => {
  let live = true;
  const session = scan(deps);
  void session.result.then((outcome) => live && done(outcome));
  const hide = () => {
    session.stop();
    done({ kind: "closed" });
  };
  const hidden = () => doc.hidden && hide();
  page.addEventListener("pagehide", hide);
  doc.addEventListener("visibilitychange", hidden);
  return () => {
    live = false;
    session.stop();
    page.removeEventListener("pagehide", hide);
    doc.removeEventListener("visibilitychange", hidden);
  };
};
