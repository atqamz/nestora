import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { ZOOMED, keyboardInset } from "../domain/viewport.ts";

export const useSheet = (dialog: RefObject<HTMLDialogElement | null>, active: boolean, onHashChange: () => void) => {
  const latest = useRef(onHashChange);
  latest.current = onHashChange;

  useEffect(() => {
    if (!active) return;
    const element = dialog.current!;
    const viewport = window.visualViewport;
    const close = () => latest.current();
    const place = () => {
      if (!viewport) return;
      element.style.setProperty("--kb", `${keyboardInset(innerHeight, viewport)}px`);
      element.style.setProperty("--vv-h", `${viewport.scale > ZOOMED ? innerHeight : viewport.height}px`);
    };
    const first = document.documentElement.style.getPropertyValue("--lock-gap") === "";
    if (first) document.documentElement.style.setProperty("--lock-gap", `${innerWidth - document.documentElement.clientWidth}px`);
    place();
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);
    addEventListener("hashchange", close);
    return () => {
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
      removeEventListener("hashchange", close);
      if (first) document.documentElement.style.removeProperty("--lock-gap");
      element.style.removeProperty("--kb");
      element.style.removeProperty("--vv-h");
    };
  }, [dialog, active]);
};
