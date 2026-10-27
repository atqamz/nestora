import { useEffect, useId, useRef } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { Icon } from "./icons.tsx";
import { PausedNote } from "./paused-note.tsx";
import { text } from "./text.ts";
import { useSheet } from "./use-sheet.ts";

type Props = {
  title: string;
  onClose: () => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  foot?: ReactNode;
  dismissible?: true;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
};

export function Modal({ title, onClose, onSubmit, foot, dismissible, className, style, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useSheet(dialog, true, onClose);

  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!element.open) element.showModal();
    element.querySelector<HTMLElement>("[data-first], .sheet-body input:not([type=radio]), .sheet-body select, .sheet-body textarea")?.focus();
    return () => {
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
      <div className="sheet-body">
        {onSubmit && <PausedNote />}
        {children}
      </div>
      {foot && <div className="sheet-foot">{foot}</div>}
    </>
  );
  return (
    <dialog
      ref={dialog}
      className={className ? `add-sheet ${className}` : "add-sheet"}
      style={style}
      aria-labelledby={heading}
      onClose={(event) => event.target === event.currentTarget && onClose()}
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
