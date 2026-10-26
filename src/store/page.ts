import { TRIGGER_GAP_MS, createLive } from "./live.ts";
import type { Later } from "./partition.ts";
import type { Store } from "./store.ts";

export type Page = {
  win: EventTarget;
  doc: EventTarget & Pick<Document, "visibilityState">;
  nav: Pick<Navigator, "onLine">;
  now: () => number;
  later: Later;
};

const touching = { passive: true, capture: true };

export const wirePage = (store: Pick<Store, "poll" | "sync" | "getSnapshot">, { win, doc, nav, now, later }: Page) => {
  const live = createLive({
    sync: store.poll,
    read: store.getSnapshot,
    now,
    later,
    visible: () => doc.visibilityState === "visible",
    online: () => nav.onLine !== false,
  });
  let probed = -Infinity;
  const wake = () => {
    if (doc.visibilityState !== "visible" || live.trigger() || now() - probed < TRIGGER_GAP_MS) return;
    probed = now();
    void store.sync();
  };
  const listeners: [EventTarget, string, () => void, AddEventListenerOptions?][] = [
    [win, "pointerdown", live.touch, touching],
    [win, "keydown", live.touch, touching],
    [doc, "visibilitychange", () => (doc.visibilityState === "visible" ? wake() : live.stop())],
    [win, "pageshow", wake],
    [win, "focus", wake],
    [win, "online", wake],
  ];
  for (const [target, type, listener, options] of listeners) target.addEventListener(type, listener, options);
  return () => {
    live.stop();
    for (const [target, type, listener, options] of listeners) target.removeEventListener(type, listener, options);
  };
};
