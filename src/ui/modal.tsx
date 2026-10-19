import { useEffect, useId, useRef } from "react";
import type { FormEvent, ReactNode } from "react";
import { ZOOMED, keyboardInset } from "../domain/viewport.ts";
import { Icon } from "./icons.tsx";
import { text } from "./text.ts";

type Props = {
  title: string;
  onClose: () => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  foot?: ReactNode;
  dismissible?: true;
  children: ReactNode;
};

export function Modal({ title, onClose, onSubmit, foot, dismissible, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const latest = useRef(onClose);
  latest.current = onClose;

  useEffect(() => {
    const close = () => latest.current();
    const element = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const viewport = window.visualViewport;
    const place = () => {
      if (!viewport) return;
      element.style.setProperty("--kb", `${keyboardInset(innerHeight, viewport)}px`);
      element.style.setProperty("--vv-h", `${viewport.scale > ZOOMED ? innerHeight : viewport.height}px`);
    };
    document.documentElement.style.setProperty("--lock-gap", `${innerWidth - document.documentElement.clientWidth}px`);
    if (!element.open) element.showModal();
    element.querySelector<HTMLElement>("[data-first], .sheet-body input:not([type=radio]), .sheet-body select, .sheet-body textarea")?.focus();
    place();
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);
    addEventListener("hashchange", close);
    return () => {
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
      removeEventListener("hashchange", close);
      document.documentElement.style.removeProperty("--lock-gap");
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const inside = (
    <>
      <div className="sheet-head">
        <h2 id={heading}>{title}</h2>
        <button type="button" className="ib" aria-label={text.sheet.close} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="sheet-body">{children}</div>
      {foot && <div className="sheet-foot">{foot}</div>}
    </>
  );
  return (
    <dialog
      ref={dialog}
      className="add-sheet"
      aria-labelledby={heading}
      onClose={onClose}
      onClick={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      {onSubmit ? (
        <form className="sheet-form" noValidate onSubmit={onSubmit}>
          {inside}
        </form>
      ) : (
        <div className="sheet-form">{inside}</div>
      )}
    </dialog>
  );
}
