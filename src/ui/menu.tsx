import { useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { menuAnchor, menuHeight, menuTarget } from "../domain/menu.ts";
import type { MenuItem } from "../domain/menu.ts";
import { Icon } from "./icons.tsx";
import { Modal } from "./modal.tsx";
import { swallowClicks } from "./swallow-clicks.ts";
import { text } from "./text.ts";

export function Menu({ name, items }: { name: string; items: readonly MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<CSSProperties>();
  const show = (event: MouseEvent<HTMLButtonElement>) => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    setAnchor(menuAnchor(event.currentTarget.getBoundingClientRect(), { width: innerWidth, height: innerHeight }, menuHeight(items.length, rem)) as CSSProperties);
    setOpen(true);
  };
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const entries = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const to = menuTarget(event.key, entries.indexOf(document.activeElement as HTMLElement), entries.length);
    if (to === null) return;
    event.preventDefault();
    entries[to].focus();
  };
  return (
    <>
      <button type="button" className="secondary" aria-haspopup="menu" aria-expanded={open} aria-label={name} onClick={show}>
        <Icon name="more" />
        {text.menu.more}
      </button>
      {open && (
        <Modal title={text.menu.more} onClose={() => setOpen(false)} dismissible className="menu-sheet" style={anchor}>
          <div className="menu" role="menu" aria-label={name} onKeyDown={move}>
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={item.danger ? "danger" : undefined}
                data-first={index === 0 ? "" : undefined}
                onClick={(event) => {
                  swallowClicks(document, 400);
                  event.currentTarget.closest("dialog")?.close();
                  setOpen(false);
                  item.run();
                }}
              >
                <Icon name={item.icon} />
                {item.label}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
